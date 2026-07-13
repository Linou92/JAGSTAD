const { getCalendarClient } = require("./calendar-client");
const { DateTime } = require("luxon");

const TIME_ZONE =
  process.env.GOOGLE_CALENDAR_TIMEZONE || "Europe/Stockholm";

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;

const WORK_START_HOUR = 8;
const WORK_END_HOUR = 17;
const SLOT_INTERVAL_MINUTES = 60;
const SLOT_DURATION_MINUTES = 240;

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

function formatLocalDate(date) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function overlaps(slotStart, slotEnd, busyPeriods) {
  return busyPeriods.some((busyPeriod) => {
    const busyStart = DateTime.fromISO(busyPeriod.start);
    const busyEnd = DateTime.fromISO(busyPeriod.end);

    return slotStart < busyEnd && slotEnd > busyStart;
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return jsonResponse(405, {
      error: "Method not allowed.",
    });
  }

  if (!CALENDAR_ID) {
    return jsonResponse(500, {
      error: "Calendar ID is missing.",
    });
  }

  const selectedDate = event.queryStringParameters?.date;

  if (!selectedDate || !/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
    return jsonResponse(400, {
      error: "A valid date is required.",
    });
  }

try {
    const selectedDay = DateTime.fromISO(selectedDate, {
      zone: TIME_ZONE,
    });

    if (!selectedDay.isValid) {
      return jsonResponse(400, {
        error: "The selected date is invalid.",
      });
    }

    const dayStart = selectedDay.startOf("day");
    const dayEnd = selectedDay.endOf("day");

    const calendar = getCalendarClient();

    const freeBusyResponse = await calendar.freebusy.query({
      requestBody: {
        timeMin: dayStart.toUTC().toISO(),
        timeMax: dayEnd.toUTC().toISO(),
        timeZone: TIME_ZONE,
        items: [{ id: CALENDAR_ID }],
      },
    });

    const calendarData =
      freeBusyResponse.data.calendars?.[CALENDAR_ID];

    if (calendarData?.errors?.length) {
      console.error("Google Calendar error:", calendarData.errors);

      return jsonResponse(502, {
        error: "Google Calendar could not be accessed.",
      });
    }

    const busyPeriods = calendarData?.busy || [];
    const availableSlots = [];

    let slotStart = selectedDay.set({
      hour: WORK_START_HOUR,
      minute: 0,
      second: 0,
      millisecond: 0,
    });

    const workDayEnd = selectedDay.set({
      hour: WORK_END_HOUR,
      minute: 0,
      second: 0,
      millisecond: 0,
    });

    while (slotStart < workDayEnd) {
      const slotEnd = slotStart.plus({
        minutes: SLOT_DURATION_MINUTES,
      });

      if (slotEnd > workDayEnd) {
        break;
      }

      if (!overlaps(slotStart, slotEnd, busyPeriods)) {
        availableSlots.push({
          start: slotStart.toUTC().toISO(),
          end: slotEnd.toUTC().toISO(),

          label: slotStart.toFormat("HH:mm"),

          localStart: slotStart.toISO(),
          localEnd: slotEnd.toISO(),
        });
      }

      slotStart = slotStart.plus({
        minutes: SLOT_INTERVAL_MINUTES,
      });
    }

    return jsonResponse(200, {
      date: selectedDate,
      timeZone: TIME_ZONE,
      slots: availableSlots,
    });
  } catch (error) {
    console.error("Availability error:", error);

    return jsonResponse(500, {
      error: "Kunde inte hämta lediga tider.",
    });
  }
};