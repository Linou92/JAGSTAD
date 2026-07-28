const { DateTime } = require("luxon");
const { getCalendarClient } = require("./calendar-client");

/* =========================================================
   CONFIGURATION
   =========================================================*/

const TIME_ZONE = process.env.GOOGLE_CALENDAR_TIMEZONE || "Europe/Stockholm";

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;

const MAX_BOOKINGS_PER_DAY = 2;
const MONTH_FORMAT = "yyyy-MM";
const DATE_FORMAT = "yyyy-MM-dd";

/* =========================================================
   RESPONSE HELPERS
   =========================================================*/

/* Creates a JSON response compatible with Netlify Functions */
function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

/* =========================================================
   VALIDATION
   =========================================================*/

/* Validates the month query parameter */
function validateMonthParameter(monthParameter) {
  if (!monthParameter) {
    return "Month parameter is required.";
  }

  if (!/^\d{4}-\d{2}$/.test(monthParameter)) {
    return "A valid month in YYYY-MM format is required.";
  }

  const monthStart = DateTime.fromFormat(monthParameter, MONTH_FORMAT, {
    zone: TIME_ZONE,
  });

  if (!monthStart.isValid) {
    return "The selected month is invalid.";
  }

  /* Luxon may accept values that match the format but
   * do not represent the exact requested month.
   * This ensures the parsed value matches the input. */
  if (monthStart.toFormat(MONTH_FORMAT) !== monthParameter) {
    return "The selected month is invalid.";
  }

  return null;
}

/* Returns the first day of a valid month */
function getMonthStart(monthParameter) {
  return DateTime.fromFormat(monthParameter, MONTH_FORMAT, {
    zone: TIME_ZONE,
  }).startOf("month");
}

/* =========================================================
  CALENDAR EVENT DATE PROCESSING
   =========================================================*/

/**
 * Returns every local date touched by a Google Calendar event.
 * Supports:
 * - all-day events
 * - timed events
 * - multi-day events
 * Cancelled or invalid events return an empty array.
 */
function getEventDates(event) {
  if (event.status === "cancelled") {
    return [];
  }

  if (event.start?.date && event.end?.date) {
    return getAllDayEventDates(event);
  }

  if (event.start?.dateTime && event.end?.dateTime) {
    return getTimedEventDates(event);
  }
  return [];
}

/**
 * Returns all dates covered by an all-day event.
 * Google Calendar treats end.date as exclusive.
 * Example:
 * start.date = 2026-08-10
 * end.date   = 2026-08-12
 * Covered dates:
 * - 2026-08-10
 * - 2026-08-11
 */
function getAllDayEventDates(calendarEvent) {
  const start = DateTime.fromISO(calendarEvent.start.date, {
    zone: TIME_ZONE,
  }).startOf("day");
  const exclusiveEnd = DateTime.fromISO(calendarEvent.end.date, {
    zone: TIME_ZONE,
  }).startOf("day");

  if (!start.isValid || !exclusiveEnd.isValid || exclusiveEnd <= start) {
    return [];
  }

  const dates = [];

  for (let day = start; day < exclusiveEnd; day = day.plus({ days: 1 })) {
    dates.push(day.toFormat(DATE_FORMAT));
  }

  return dates;
}

/**
 * Returns all local dates touched by a timed event.
 * One millisecond is removed from the end time because
 * event end times are treated as exclusive.
 */
function getTimedEventDates(calendarEvent) {
  const start = DateTime.fromISO(calendarEvent.start.dateTime).setZone(
    TIME_ZONE,
  );

  const end = DateTime.fromISO(calendarEvent.end.dateTime).setZone(TIME_ZONE);

  if (!start.isValid || !end.isValid || end <= start) {
    return [];
  }

  const firstDay = start.startOf("day");

  const finalDay = end.minus({ milliseconds: 1 }).startOf("day");

  const dates = [];

  for (let day = firstDay; day <= finalDay; day = day.plus({ days: 1 })) {
    dates.push(day.toFormat(DATE_FORMAT));
  }

  return dates;
}

/* =========================================================
  GOOGLE CALENDAR
   =========================================================*/

/**
 * Retrieves all Google Calendar events within a time range.
 * Pagination is handled automatically.
 */
async function getAllEvents(calendar, timeMin, timeMax) {
  const events = [];
  let pageToken;

  do {
    const response = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin,
      timeMax,

      /* Expand recurring events into individual events */
      singleEvents: true,

      /* Cancelled and deleted events should not count */
      showDeleted: false,

      orderBy: "startTime",
      maxResults: 2500,
      pageToken,
      timeZone: TIME_ZONE,

      /*
       * Only count events created by the website.
       * Remove this property if the calendar contains
       * booking events without source=website.
       */
      privateExtendedProperty: "source=website",
    });

    events.push(...(response.data.items || []));

    pageToken = response.data.nextPageToken;
  } while (pageToken);

  return events;
}

/* =========================================================
  BOOKING COUNT
   =========================================================*/

/**
 * Creates a map containing the number of bookings per date.
 * Example:
 * Map {
 *   "2026-08-10" => 2,
 *   "2026-08-11" => 1
 * }
 */
function createBookingCountByDate(calendarEvents) {
  const bookingCountByDate = new Map();

  for (const calendarEvent of calendarEvents) {
    const eventDates = getEventDates(calendarEvent);

    for (const date of eventDates) {
      incrementBookingCount(bookingCountByDate, date);
    }
  }

  return bookingCountByDate;
}

/* Increases the booking count for one date */
function incrementBookingCount(bookingCountByDate, date) {
  const currentCount = bookingCountByDate.get(date) || 0;
  bookingCountByDate.set(date, currentCount + 1);
}

/* =========================================================
   AVAILABILITY CALCULATION
   =========================================================*/

/* Returns true when a date can no longer be booked */
function isUnavailableDay({ day, today, bookingCount }) {
  const isPast = day < today;
  const isWeekend = day.weekday > 5;
  const isFullyBooked = bookingCount >= MAX_BOOKINGS_PER_DAY;
  return isPast || isWeekend || isFullyBooked;
}

/* Builds the available and unavailable date lists for an entire month */
function buildMonthlyAvailability({ monthStart, bookingCountByDate }) {
  const today = DateTime.now().setZone(TIME_ZONE).startOf("day");

  const monthEnd = monthStart.endOf("month");

  const availableDays = [];
  const unavailableDays = [];

  for (let day = monthStart; day <= monthEnd; day = day.plus({ days: 1 })) {
    const date = day.toFormat(DATE_FORMAT);
    const bookingCount = bookingCountByDate.get(date) || 0;
    const unavailable = isUnavailableDay({
      day,
      today,
      bookingCount,
    });

    if (unavailable) {
      unavailableDays.push({
        date,
        bookingCount,
      });

      continue;
    }

    availableDays.push({
      date,
      bookingCount,
      remainingBookings: MAX_BOOKINGS_PER_DAY - bookingCount,
    });
  }

  return { availableDays, unavailableDays };
}

/* =========================================================
   NETLIFY HANDLER
   =========================================================*/

exports.handler = async function handler(event) {
  /* This endpoint only provides availability, so only GET requests are accepted */
  if (event.httpMethod !== "GET") {
    return jsonResponse(405, {
      error: "Method not allowed.",
    });
  }

  /* The calendar ID must exist before Google Calendar can be queried */
  if (!CALENDAR_ID) {
    return jsonResponse(500, {
      error: "Google Calendar ID is missing.",
    });
  }

  const monthParameter = event.queryStringParameters?.month;

  const validationError = validateMonthParameter(monthParameter);

  if (validationError) {
    return jsonResponse(400, {
      error: validationError,
    });
  }

  try {
    /* ----------------------------------------------------------
       1. Calculate the requested month range
       ---------------------------------------------------------- */

    const monthStart = getMonthStart(monthParameter);

    const monthEndExclusive = monthStart.plus({ months: 1 });

    /* ----------------------------------------------------------
       2. Retrieve calendar events
       ---------------------------------------------------------- */

    const calendar = getCalendarClient();

    const calendarEvents = await getAllEvents(
      calendar,
      monthStart.toUTC().toISO(),
      monthEndExclusive.toUTC().toISO(),
    );

    /* ----------------------------------------------------------
       3. Count bookings for each date
       ---------------------------------------------------------- */

    const bookingCountByDate = createBookingCountByDate(calendarEvents);

    /* ----------------------------------------------------------
       4. Calculate available and unavailable dates
       ---------------------------------------------------------- */

    const { availableDays, unavailableDays } = buildMonthlyAvailability({
      monthStart,
      bookingCountByDate,
    });

    /* ----------------------------------------------------------
       5. Return availability
       ---------------------------------------------------------- */

    return jsonResponse(200, {
      month: monthParameter,
      timeZone: TIME_ZONE,
      maxBookingsPerDay: MAX_BOOKINGS_PER_DAY,
      availableDays,
      unavailableDays,
    });
  } catch (error) {
    console.error("Availability error:", error);

    return jsonResponse(500, {
      error: "Kunde inte hämta lediga dagar.",
    });
  }
};
