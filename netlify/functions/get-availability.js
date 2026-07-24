const { DateTime } = require("luxon");
const { getCalendarClient } = require("./calendar-client");

const TIME_ZONE =
  process.env.GOOGLE_CALENDAR_TIMEZONE || "Europe/Stockholm";

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;

const MAX_BOOKINGS_PER_DAY = 2;

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

/**
 * Returns every local date touched by an event.
 *
 * Normally a cleaning job starts and finishes on the same day,
 * but this also handles all-day and multi-day events safely.
 */
function getEventDates(event) {
  if (event.status === "cancelled") {
    return [];
  }

  /*
   * All-day events use start.date and end.date.
   * Google Calendar treats end.date as exclusive.
   */
  if (event.start?.date && event.end?.date) {
    const start = DateTime.fromISO(event.start.date, {
      zone: TIME_ZONE,
    }).startOf("day");

    const exclusiveEnd = DateTime.fromISO(event.end.date, {
      zone: TIME_ZONE,
    }).startOf("day");

    const dates = [];

    for (
      let day = start;
      day < exclusiveEnd;
      day = day.plus({ days: 1 })
    ) {
      dates.push(day.toFormat("yyyy-MM-dd"));
    }

    return dates;
  }

  /*
   * Timed events use start.dateTime and end.dateTime.
   */
  if (event.start?.dateTime && event.end?.dateTime) {
    const start = DateTime.fromISO(event.start.dateTime)
      .setZone(TIME_ZONE);

    const end = DateTime.fromISO(event.end.dateTime)
      .setZone(TIME_ZONE);

    if (!start.isValid || !end.isValid) {
      return [];
    }

    const dates = [];

    let day = start.startOf("day");
    const finalDay = end.minus({ milliseconds: 1 }).startOf("day");

    while (day <= finalDay) {
      dates.push(day.toFormat("yyyy-MM-dd"));
      day = day.plus({ days: 1 });
    }

    return dates;
  }

  return [];
}

async function getAllEvents(calendar, timeMin, timeMax) {
  const events = [];
  let pageToken;

  do {
    const response = await calendar.events.list({
      calendarId: CALENDAR_ID,

      timeMin,
      timeMax,

      /*
       * Expand recurring events into their individual occurrences.
       */
      singleEvents: true,

      /*
       * Deleted events should not count as bookings.
       */
      showDeleted: false,

      orderBy: "startTime",
      maxResults: 2500,

      pageToken,
      timeZone: TIME_ZONE,
    });

    events.push(...(response.data.items || []));
    pageToken = response.data.nextPageToken;
  } while (pageToken);

  return events;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return jsonResponse(405, {
      error: "Method not allowed.",
    });
  }

  if (!CALENDAR_ID) {
    return jsonResponse(500, {
      error: "Google Calendar ID is missing.",
    });
  }

  const monthParameter = event.queryStringParameters?.month;

  if (
    !monthParameter ||
    !/^\d{4}-\d{2}$/.test(monthParameter)
  ) {
    return jsonResponse(400, {
      error: "A valid month in YYYY-MM format is required.",
    });
  }

  try {
    const monthStart = DateTime.fromFormat(
      monthParameter,
      "yyyy-MM",
      {
        zone: TIME_ZONE,
      }
    ).startOf("month");

    if (!monthStart.isValid) {
      return jsonResponse(400, {
        error: "The selected month is invalid.",
      });
    }

    const monthEndExclusive = monthStart.plus({ months: 1 });

    const calendar = getCalendarClient();

    const calendarEvents = await getAllEvents(
      calendar,
      monthStart.toUTC().toISO(),
      monthEndExclusive.toUTC().toISO()
    );

    /*
     * Map structure:
     *
     * {
     *   "2026-08-10" => 2,
     *   "2026-08-11" => 1
     * }
     */
    const bookingCountByDate = new Map();

    calendarEvents.forEach((calendarEvent) => {
      const eventDates = getEventDates(calendarEvent);

      eventDates.forEach((date) => {
        const currentCount =
          bookingCountByDate.get(date) || 0;

        bookingCountByDate.set(
          date,
          currentCount + 1
        );
      });
    });

    const today = DateTime.now()
      .setZone(TIME_ZONE)
      .startOf("day");

    const monthEnd = monthStart.endOf("month");

    const availableDays = [];
    const unavailableDays = [];

    for (
      let day = monthStart;
      day <= monthEnd;
      day = day.plus({ days: 1 })
    ) {
      const date = day.toFormat("yyyy-MM-dd");

      const isPast = day < today;
      const isWeekend = day.weekday > 5;

      const bookingCount =
        bookingCountByDate.get(date) || 0;

      if (
        isPast ||
        isWeekend ||
        bookingCount >= MAX_BOOKINGS_PER_DAY
      ) {
        unavailableDays.push({
          date,
          bookingCount,
        });

        continue;
      }

      availableDays.push({
        date,
        bookingCount,
        remainingBookings:
          MAX_BOOKINGS_PER_DAY - bookingCount,
      });
    }

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