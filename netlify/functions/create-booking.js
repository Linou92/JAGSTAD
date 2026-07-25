const { Resend } = require("resend");
const twilio = require("twilio");
const { google } = require("googleapis");
const { DateTime } = require("luxon");

const TIME_ZONE = process.env.GOOGLE_CALENDAR_TIMEZONE || "Europe/Stockholm";

const MAX_BOOKINGS_PER_DAY = 2;

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cleanString(value, maxLength = 300) {
  return String(value ?? "")
    .trim()
    .slice(0, maxLength);
}

function normalizeArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => cleanString(item, 100)).filter(Boolean);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeSwedishPhone(phone) {
  const cleaned = String(phone ?? "")
    .trim()
    .replace(/[^\d+]/g, "");

  if (cleaned.startsWith("+46")) {
    return cleaned;
  }

  if (cleaned.startsWith("0046")) {
    return `+46${cleaned.slice(4)}`;
  }

  if (cleaned.startsWith("0")) {
    return `+46${cleaned.slice(1)}`;
  }

  return cleaned;
}

function isValidSwedishPhone(phone) {
  return /^\+46\d{7,12}$/.test(phone);
}

function getCalendarClient() {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!clientEmail || !privateKey) {
    throw new Error("Google Calendar credentials are missing.");
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });

  return google.calendar({
    version: "v3",
    auth,
  });
}

async function countBookingsForDate(calendar, selectedDate) {
  const start = DateTime.fromISO(selectedDate, {
    zone: TIME_ZONE,
  }).startOf("day");

  const end = start.plus({ days: 1 });

  const response = await calendar.events.list({
    calendarId: process.env.GOOGLE_CALENDAR_ID,
    timeMin: start.toUTC().toISO(),
    timeMax: end.toUTC().toISO(),
    singleEvents: true,
    showDeleted: false,
    maxResults: 50,
  });

  return response.data.items?.length || 0;
}

function formatSwedishDate(date) {
  return DateTime.fromISO(date, {
    zone: TIME_ZONE,
  })
    .setLocale("sv")
    .toLocaleString({
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, {
      error: "Method not allowed.",
    });
  }

  try {
    const body = JSON.parse(event.body || "{}");

    const requiredVariables = [
      "GOOGLE_CALENDAR_ID",
      "GOOGLE_CLIENT_EMAIL",
      "GOOGLE_PRIVATE_KEY",
      "RESEND_API_KEY",
      "ADMIN_EMAIL",
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_PHONE_NUMBER",
    ];

    const missingVariables = requiredVariables.filter(
      (name) => !process.env[name],
    );

    if (missingVariables.length > 0) {
      throw new Error(
        `Missing environment variables: ${missingVariables.join(", ")}`,
      );
    }

    const booking = {
      name: cleanString(body.name, 100),
      email: cleanString(body.email, 160).toLowerCase(),
      phone: normalizeSwedishPhone(body.phone),
      companyName: cleanString(body.companyName, 150),
      area: cleanString(body.area, 50),
      selectedDate: cleanString(body.selectedDate, 10),
      service: cleanString(body.service, 100),
      cleaningOptions: normalizeArray(body.cleaningOptions),
      rooms: normalizeArray(body.rooms),
      bedrooms: cleanString(body.bedrooms, 10),
      bathrooms: cleanString(body.bathrooms, 10),
    };

    if (!booking.name) {
      return jsonResponse(400, {
        error: "Namn saknas.",
      });
    }

    if (!isValidEmail(booking.email)) {
      return jsonResponse(400, {
        error: "E-postadressen är ogiltig.",
      });
    }

    if (!isValidSwedishPhone(booking.phone)) {
      return jsonResponse(400, {
        error: "Telefonnumret är ogiltigt.",
      });
    }

    const date = DateTime.fromISO(booking.selectedDate, {
      zone: TIME_ZONE,
    });

    if (!date.isValid) {
      return jsonResponse(400, {
        error: "Det valda datumet är ogiltigt.",
      });
    }

    if (
      date.startOf("day") < DateTime.now().setZone(TIME_ZONE).startOf("day")
    ) {
      return jsonResponse(400, {
        error: "Det valda datumet har redan passerat.",
      });
    }

    if (date.weekday === 6 || date.weekday === 7) {
      return jsonResponse(400, {
        error: "Helger är inte bokningsbara.",
      });
    }

    const calendar = getCalendarClient();

    /*
     * Important:
     * Check availability again here, even though the frontend already
     * showed the day as available. This prevents two people from booking
     * the final place at nearly the same time.
     */
    const bookingCount = await countBookingsForDate(
      calendar,
      booking.selectedDate,
    );

    if (bookingCount >= MAX_BOOKINGS_PER_DAY) {
      return jsonResponse(409, {
        error: "Datumet blev precis fullbokat. Välj ett annat datum.",
      });
    }

    const formattedDate = formatSwedishDate(booking.selectedDate);

    const bookingReference =
      `JAG-${booking.selectedDate.replaceAll("-", "")}-` +
      Math.random().toString(36).slice(2, 7).toUpperCase();

    const detailsText = [
      `Bokningsnummer: ${bookingReference}`,
      `Datum: ${formattedDate}`,
      `Namn: ${booking.name}`,
      `Företag: ${booking.companyName || "Ej angivet"}`,
      `E-post: ${booking.email}`,
      `Telefon: ${booking.phone}`,
      `Yta: ${booking.area || "Ej angiven"}`,
      `Tjänst: ${booking.service || "Ej angiven"}`,
      `Städval: ${booking.cleaningOptions.join(", ") || "Ej angivet"}`,
      `Rum: ${booking.rooms.join(", ") || "Ej angivet"}`,
      `Antal sovrum: ${booking.bedrooms || "Ej angivet"}`,
      `Antal badrum: ${booking.bathrooms || "Ej angivet"}`,
    ].join("\n");

    /*
     * Create an all-day Google Calendar event.
     *
     * Google Calendar uses an exclusive end date for all-day events,
     * so the end date must be the following day.
     */
    await calendar.events.insert({
      calendarId: process.env.GOOGLE_CALENDAR_ID,
      requestBody: {
        summary: `${booking.service || "Städning"} – ${booking.name}`,
        description: detailsText,
        start: {
          date: booking.selectedDate,
        },
        end: {
          date: date.plus({ days: 1 }).toISODate(),
        },
        extendedProperties: {
          private: {
            bookingReference,
            source: "website",
          },
        },
      },
    });

    const resend = new Resend(process.env.RESEND_API_KEY);

    const fromEmail = process.env.BOOKING_FROM_EMAIL;
    const adminEmail = process.env.ADMIN_EMAIL;

    if (!fromEmail || !adminEmail) {
      throw new Error("Email sender or admin email is missing.");
    }

    /*const clientEmailHtml = `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#173c60">
        <h1 style="color:#173c60">Tack för din bokningsförfrågan</h1>

        <p>Hej ${escapeHtml(booking.name)},</p>

        <p>
          Vi har tagit emot din bokningsförfrågan för
          <strong>${escapeHtml(formattedDate)}</strong>.
        </p>

        <p>
          Vi kommer att kontakta dig inom 24 timmar för att bekräfta detaljerna.
        </p>

        <div style="
          margin:24px 0;
          padding:18px;
          border:1px solid #c7a24a;
          border-radius:12px;
          background:#f8f6f0;
        ">
          <p><strong>Bokningsnummer:</strong>
            ${escapeHtml(bookingReference)}
          </p>

          <p><strong>Tjänst:</strong>
            ${escapeHtml(booking.service || "Städning")}
          </p>

          <p><strong>Datum:</strong>
            ${escapeHtml(formattedDate)}
          </p>
        </div>

        <p>Vänliga hälsningar,<br>Elite Städ Och Service</p>
      </div>
    `;

    const adminEmailHtml = `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#173c60">
        <h1>Ny bokningsförfrågan</h1>

        <table style="border-collapse:collapse;width:100%;max-width:700px">
          <tbody>
            ${emailRow("Bokningsnummer", bookingReference)}
            ${emailRow("Datum", formattedDate)}
            ${emailRow("Namn", booking.name)}
            ${emailRow("Företag", booking.companyName)}
            ${emailRow("E-post", booking.email)}
            ${emailRow("Telefon", booking.phone)}
            ${emailRow("Yta", booking.area)}
            ${emailRow("Tjänst", booking.service)}
            ${emailRow("Städval", booking.cleaningOptions.join(", "))}
            ${emailRow("Rum", booking.rooms.join(", "))}
            ${emailRow("Antal sovrum", booking.bedrooms)}
            ${emailRow("Antal badrum", booking.bathrooms)}
          </tbody>
        </table>
      </div>
    `;*/

    /*
     * Send the client and admin emails together.
     */
    /*const emailResults = await Promise.allSettled([
      resend.emails.send({
        from: fromEmail,
        to: booking.email,
        subject: `Vi har tagit emot din bokning – ${formattedDate}`,
        html: clientEmailHtml,
        replyTo: adminEmail,
      }),

      resend.emails.send({
        from: fromEmail,
        to: adminEmail,
        subject: `Ny bokning: ${booking.name} – ${formattedDate}`,
        html: adminEmailHtml,
        replyTo: booking.email,
      }),
    ]);*/
    const adminEmailResult = await resend.emails.send({
      from: "Elite Städ Och Service <onboarding@resend.dev>",
      to: "lina_abuhijleh@hotmail.com",
      subject: `Ny bokning: ${booking.name} – ${formattedDate}`,
      html: adminEmailHtml,
      replyTo: booking.email,
    });

    if (adminEmailResult.error) {
      console.error("Admin email failed:", adminEmailResult.error);
    }

    const adminEmailSent = !adminEmailResult.error;
    const clientEmailSent = false;

    /*for (const result of emailResults) {
      if (result.status === "rejected") {
        console.error("Email failed:", result.reason);
      }
    }*/

    /*
     * Send confirmation SMS.
     */
    const twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN,
    );

    let smsSent = false;

    try {
      await twilioClient.messages.create({
        from: process.env.TWILIO_PHONE_NUMBER,
        to: booking.phone,
        body:
          `Hej ${booking.name}! Vi har tagit emot din ` +
          `bokningsförfrågan hos Elite Städ Och Service för ${formattedDate}. ` +
          `Bokningsnummer: ${bookingReference}. ` +
          `Vi kontaktar dig inom 24 timmar för bekräftelse.`,
      });

      smsSent = true;
    } catch (smsError) {
      console.error("SMS failed:", smsError);
    }

    return jsonResponse(200, {
      success: true,
      bookingReference,
      message: "Bokningen har tagits emot.",
      notifications: {
        clientEmailSent,
        adminEmailSent,
        smsSent,
      },
    });
  } catch (error) {
    console.error("create-booking failed:", error);

    return jsonResponse(500, {
      error: "Bokningen kunde inte skickas. Försök igen senare.",
      details: process.env.CONTEXT === "dev" ? error.message : undefined,
    });
  }
};

function emailRow(label, value) {
  return `
    <tr>
      <th style="
        text-align:left;
        vertical-align:top;
        padding:10px;
        border-bottom:1px solid #ddd;
        width:190px;
      ">
        ${escapeHtml(label)}
      </th>

      <td style="
        padding:10px;
        border-bottom:1px solid #ddd;
      ">
        ${escapeHtml(value || "Ej angivet")}
      </td>
    </tr>
  `;
}
