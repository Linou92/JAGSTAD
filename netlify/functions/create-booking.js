/* =========================================================
   Elite Städ & Service
   Create Booking Netlify Function

   Responsibilities
   - Validate booking requests
   - Create Google Calendar events
   - Send confirmation emails
   - Send SMS confirmation
   - Return booking status

   =========================================================*/

const { Resend } = require("resend");
const twilio = require("twilio");
const { google } = require("googleapis");
const { DateTime } = require("luxon");

/* =========================================================
   CONFIGURATION
   =========================================================*/

const TIME_ZONE = process.env.GOOGLE_CALENDAR_TIMEZONE || "Europe/Stockholm";

const MAX_BOOKINGS_PER_DAY = 2;

/*
|------------------------------------------------------------
| Required Environment Variables
|------------------------------------------------------------
|
| These variables must exist before the function can run.
|
*/

const REQUIRED_ENV_VARIABLES = [
  "GOOGLE_CALENDAR_ID",
  "GOOGLE_CLIENT_EMAIL",
  "GOOGLE_PRIVATE_KEY",

  "RESEND_API_KEY",
  /*"BOOKING_FROM_EMAIL",
  "ADMIN_EMAIL",*/

  /*"TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_PHONE_NUMBER",*/
];

/* =========================================================
   GENERAL HELPER FUNCTIONS
   =========================================================*/

/**
 * Creates a Netlify JSON response.
 */

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

/**
 * Escapes HTML before inserting user input into emails.
 */

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * Removes whitespace and limits string length.
 */

function cleanString(value, maxLength = 300) {
  return String(value ?? "")
    .trim()
    .slice(0, maxLength);
}

/**
 * Cleans an array received from the frontend.
 */

function normalizeArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => cleanString(item, 100)).filter(Boolean);
}

/* =========================================================
   VALIDATION
   =========================================================*/

function validateEnvironmentVariables() {
  const missingVariables = REQUIRED_ENV_VARIABLES.filter(
    (variable) => !process.env[variable],
  );

  if (missingVariables.length > 0) {
    throw new Error(
      `Missing environment variables: ${missingVariables.join(", ")}`,
    );
  }
}

function createBooking(body) {
  return {
    name: cleanString(body.customerName ?? body.kundsnamn ?? body.name, 100),
    email: cleanString(body.email, 160).toLowerCase(),
    phone: normalizeSwedishPhone(body.phone),
    companyName: cleanString(
      body.companyName ?? body.foretagsnamn ?? body.företagsnamn,
      150,
    ),
    area: cleanString(body.area, 50),
    selectedDate: cleanString(body.selectedDate, 10),
    service: cleanString(body.service, 100),
    cleaningOptions: normalizeArray(body.cleaningOptions),
    rooms: normalizeArray(body.rooms),
    bedrooms: cleanString(body.bedrooms, 10),
    bathrooms: cleanString(body.bathrooms, 10),
  };
}

/**
 * Validates the cleaned booking object.
 *
 * Returns:
 * - null when the booking is valid
 * - a Swedish error message when validation fails
 */

function validateBooking(booking) {
  /* REQUIRED CUSTOMER DETAILS */
  if (isPrivateCustomerBooking(booking.service)) {
    if (!booking.name) {
      return "Kundsnamn saknas.";
    }
  }

  if (isCompanyBooking(booking.service)) {
    if (!booking.companyName) {
      return "Företagsnamn saknas.";
    }
  }

  if (!booking.email) {
    return "E-postadress saknas.";
  }

  if (!isValidEmail(booking.email)) {
    return "E-postadressen är ogiltig.";
  }

  if (!booking.phone) {
    return "Telefonnummer saknas.";
  }

  if (!isValidSwedishPhone(booking.phone)) {
    return "Telefonnumret är ogiltigt.";
  }

  /* REQUIRED BOOKING DETAILS */
  if (!booking.service) {
    return "Städtjänst saknas.";
  }

  if (!booking.selectedDate) {
    return "Du måste välja ett datum.";
  }

  /* DATE VALIDATION */
  const selectedDate = DateTime.fromISO(booking.selectedDate, {
    zone: TIME_ZONE,
  });

  if (!selectedDate.isValid) {
    return "Det valda datumet är ogiltigt.";
  }

  const today = DateTime.now().setZone(TIME_ZONE).startOf("day");

  const bookingDay = selectedDate.startOf("day");

  if (bookingDay < today) {
    return "Det valda datumet har redan passerat.";
  }

  /* Luxon uses:
      Monday    = 1
      Tuesday   = 2
      Wednesday = 3
      Thursday  = 4
      Friday    = 5
      Saturday  = 6
      Sunday    = 7
    */

  const isWeekend = selectedDate.weekday === 6 || selectedDate.weekday === 7;

  if (isWeekend) {
    return "Helger är inte bokningsbara.";
  }

  /* OPTIONAL VALUE VALIDATION */
  if (booking.cleaningOptions && !Array.isArray(booking.cleaningOptions)) {
    return "Städtjänsterna har ett ogiltigt format.";
  }
  if (booking.rooms && !Array.isArray(booking.rooms)) {
    return "Rummen har ett ogiltigt format.";
  }
  if (booking.bedrooms && !isValidPositiveInteger(booking.bedrooms)) {
    return "Antalet sovrum är ogiltigt.";
  }
  if (booking.bathrooms && !isValidPositiveInteger(booking.bathrooms)) {
    return "Antalet badrum är ogiltigt.";
  }

  return null;
}

/* Checks whether a value is a whole number equal to or greater than zero */
function isValidPositiveInteger(value) {
  const textValue = String(value).trim();
  if (!/^\d+$/.test(textValue)) {
    return false;
  }
  const numberValue = Number(textValue);
  return Number.isSafeInteger(numberValue) && numberValue >= 0;
}

/* Checks if an email is valid */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/* Checks if valid swedish phone number */
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

/* =========================================================
   GOOGLE CALENDAR
   =========================================================*/

/**
 * Creates an authenticated Google Calendar client.
 */
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

/**
 * Counts the calendar events that already exist
 * on the selected booking date.
 */
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
    privateExtendedProperty: "source=website",
    maxResults: 50,
  });

  return response.data.items?.length || 0;
}

/**
 * Converts an ISO date such as 2026-08-06 into:
 * torsdag 6 augusti 2026
 */
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

/**
 * Creates a booking reference such as:
 * BOKNING-20260806-A4X7P
 */
function createBookingReference(selectedDate) {
  const datePart = selectedDate.replaceAll("-", "");
  const randomPart = Math.random().toString(36).slice(2, 7).toUpperCase();

  return `BOKNING-${datePart}-${randomPart}`;
}

/**
 * Returns a fallback text when a single value is empty.
 */
function displayValue(value) {
  return value || "Ej angivet";
}

/**
 * Converts an array into readable text.
 */
function displayList(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return "Ej angivet";
  }

  return values.join(", ");
}

/**
 * Creates the description displayed inside the Google Calendar event
 */
function buildCalendarDescription({
  booking,
  bookingReference,
  formattedDate,
}) {
  const lines = [
    `Bokningsnummer: ${bookingReference}`,
    `Datum: ${formattedDate}`,
  ];

  if (isPrivateCustomerBooking(booking.service) && booking.name) {
    lines.push(`Namn: ${booking.name}`);
  }

  if (isCompanyBooking(booking.service) && booking.companyName) {
    lines.push(`Företag: ${booking.companyName}`);
  }

  lines.push(
    `E-post: ${booking.email}`,
    `Telefon: ${booking.phone}`,
    `Tjänst: ${booking.service}`,
  );

  return lines.join("\n");
}

/**
 * Creates an all-day booking event in Google Calendar.
 * Google Calendar uses an exclusive end date for all-day
 * events. Therefore, the end date must be the next day.
 */
async function createCalendarEvent({
  calendar,
  booking,
  bookingReference,
  formattedDate,
}) {
  const selectedDate = DateTime.fromISO(booking.selectedDate, {
    zone: TIME_ZONE,
  });

  const description = buildCalendarDescription({
    booking,
    bookingReference,
    formattedDate,
  });

  const response = await calendar.events.insert({
    calendarId: process.env.GOOGLE_CALENDAR_ID,

    requestBody: {
      summary: `${booking.service || "Städning"} – ${booking.name}`,

      description,

      start: {
        date: booking.selectedDate,
      },

      end: {
        date: selectedDate
          .plus({
            days: 1,
          })
          .toISODate(),
      },

      extendedProperties: {
        private: {
          bookingReference,
          source: "website",
        },
      },
    },
  });

  return response.data;
}

/* =========================================================
   EMAIL TEMPLATES
   =========================================================*/

/* Creates one row for the administrator booking table */
function emailRow(label, value) {
  return `
    <tr>
      <th
        style="
          width:190px;
          padding:10px;
          border-bottom:1px solid #dddddd;
          text-align:left;
          vertical-align:top;
          color:#173c60;
        "
      >
        ${escapeHtml(label)}
      </th>

      <td
        style="
          padding:10px;
          border-bottom:1px solid #dddddd;
          color:#333333;
        "
      >
        ${escapeHtml(displayValue(value))}
      </td>
    </tr>
  `;
}

/* Creates the confirmation email sent to the customer */
function buildClientEmailHtml({ booking, bookingReference, formattedDate }) {
  return `
    <!doctype html>

    <html lang="sv">
      <head>
        <meta charset="UTF-8">
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0"
        >

        <title>Bokningsförfrågan</title>
      </head>

      <body
        style="
          margin:0;
          padding:0;
          background:#f5f5f5;
          font-family:Arial,Helvetica,sans-serif;
        "
      >
        <div
          style="
            max-width:650px;
            margin:0 auto;
            padding:32px 20px;
          "
        >
          <div
            style="
              overflow:hidden;
              border:1px solid #e5e5e5;
              border-radius:14px;
              background:#ffffff;
            "
          >
            <div
              style="
                padding:24px;
                background:#173c60;
                text-align:center;
              "
            >
              <h1
                style="
                  margin:0;
                  color:#ffffff;
                  font-size:26px;
                "
              >
                Elite Städ Och Service
              </h1>
            </div>

            <div
              style="
                padding:32px;
                color:#333333;
                line-height:1.7;
              "
            >
              <h2
                style="
                  margin-top:0;
                  color:#173c60;
                "
              >
                Tack för din bokningsförfrågan
              </h2>

              <p>
                Hej ${escapeHtml(booking.name)},
              </p>

              <p>
                Vi har tagit emot din bokningsförfrågan
                för
                <strong>
                  ${escapeHtml(formattedDate)}
                </strong>.
              </p>

              <p>
                Vi kommer att kontakta dig inom
                24 timmar för att bekräfta bokningen
                och dess detaljer.
              </p>

              <div
                style="
                  margin:26px 0;
                  padding:20px;
                  border:1px solid #c7a24a;
                  border-radius:12px;
                  background:#f8f6f0;
                "
              >
                <p style="margin:0 0 10px">
                  <strong>Bokningsnummer:</strong><br>

                  ${escapeHtml(bookingReference)}
                </p>

                <p style="margin:0 0 10px">
                  <strong>Tjänst:</strong><br>

                  ${escapeHtml(booking.service || "Städning")}
                </p>

                <p style="margin:0">
                  <strong>Datum:</strong><br>

                  ${escapeHtml(formattedDate)}
                </p>
              </div>

              <p>
                Spara gärna ditt bokningsnummer om du
                behöver kontakta oss angående din
                bokning.
              </p>

              <p style="margin-bottom:0">
                Vänliga hälsningar,<br>

                <strong>
                  Elite Städ Och Service
                </strong>
              </p>
            </div>
          </div>
        </div>
      </body>
    </html>
  `;
}

function normalizeServiceName(service) {
  return String(service ?? "")
    .trim()
    .toLowerCase()
    .replaceAll("ä", "a")
    .replaceAll("å", "a")
    .replaceAll("ö", "o")
    .replace(/\s+/g, "");
}

function isHomeCleaning(service) {
  return normalizeServiceName(service) === "hemstad";
}

function isMovingCleaning(service) {
  return normalizeServiceName(service) === "flyttstad";
}

function isOfficeCleaning(service) {
  return normalizeServiceName(service) === "kontorsstad";
}

function isPropertyCleaning(service) {
  return normalizeServiceName(service) === "fastighetsstad";
}

function isPrivateCustomerBooking(service) {
  return isHomeCleaning(service) || isMovingCleaning(service);
}

function isCompanyBooking(service) {
  return isOfficeCleaning(service) || isPropertyCleaning(service);
}

function optionalEmailRow(condition, label, value) {
  if (!condition || !value) {
    return "";
  }
  return emailRow(label, value);
}

/* Creates the detailed booking email sent to the administrator */
function buildAdminEmailHtml({ booking, bookingReference, formattedDate }) {
  return `
    <!doctype html>

    <html lang="sv">
      <head>
        <meta charset="UTF-8">

        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0"
        >

        <title>Ny bokningsförfrågan</title>
      </head>

      <body
        style="
          margin:0;
          padding:0;
          background:#f5f5f5;
          font-family:Arial,Helvetica,sans-serif;
        "
      >
        <div
          style="
            max-width:750px;
            margin:0 auto;
            padding:32px 20px;
          "
        >
          <div
            style="
              overflow:hidden;
              border:1px solid #e5e5e5;
              border-radius:14px;
              background:#ffffff;
            "
          >
            <div
              style="
                padding:24px;
                background:#173c60;
              "
            >
              <h1
                style="
                  margin:0;
                  color:#ffffff;
                  font-size:26px;
                "
              >
                Ny bokningsförfrågan
              </h1>
            </div>

            <div style="padding:30px">
              <p
                style="
                  margin-top:0;
                  color:#333333;
                  line-height:1.6;
                "
              >
                En ny bokningsförfrågan har skickats
                via webbplatsen.
              </p>

              <table
                role="presentation"
                style="
                  width:100%;
                  border-collapse:collapse;
                "
              >
                <tbody>
                  ${emailRow("Bokningsnummer", bookingReference)}

                  ${emailRow("Tjänst", booking.service)}

                  ${emailRow("Datum", formattedDate)}

                  ${optionalEmailRow(
                    isPrivateCustomerBooking(booking.service),
                    "Namn",
                    booking.name,
                  )}
                  
                  ${optionalEmailRow(
                    isCompanyBooking(booking.service),
                    "Företag",
                    booking.companyName,
                  )}

                  ${emailRow("E-post", booking.email)}

                  ${emailRow("Telefon", booking.phone)}

                  ${optionalEmailRow(
                    isHomeCleaning(booking.service) ||
                      isMovingCleaning(booking.service),
                    "Yta",
                    booking.area,
                  )}

                  ${emailRow(
                    "Städtjänster",
                    displayList(booking.cleaningOptions),
                  )}

                  ${optionalEmailRow(
                    isHomeCleaning(booking.service) ||
                      isOfficeCleaning(booking.service) ||
                      isPropertyCleaning(booking.service),
                    "Rum att städa",
                    displayList(booking.rooms),
                  )}

                  ${optionalEmailRow(
                    isMovingCleaning(booking.service),
                    "Antal sovrum",
                    booking.bedrooms,
                  )}

                  ${optionalEmailRow(
                    isMovingCleaning(booking.service),
                    "Antal badrum",
                    booking.bathrooms,
                  )}
                </tbody>
              </table>

              <p
                style="
                  margin:24px 0 0;
                  color:#666666;
                  font-size:14px;
                "
              >
                Svara på detta mejl för att kontakta
                kunden direkt.
              </p>
            </div>
          </div>
        </div>
      </body>
    </html>
  `;
}

/* =========================================================
   NOTIFICATIONS
   =========================================================*/

/* Sends one email and returns whether it succeeded */
async function sendEmailSafely({
  resend,
  emailType,
  from,
  to,
  subject,
  html,
  replyTo,
}) {
  try {
    const result = await resend.emails.send({
      from,
      to,
      subject,
      html,
      replyTo,
    });

    if (result.error) {
      console.error(`${emailType} email failed:`, result.error);

      return false;
    }

    console.log(`${emailType} email sent:`, result.data?.id);

    return true;
  } catch (error) {
    console.error(`${emailType} email failed:`, error);

    return false;
  }
}

/**
 * Sends:
 * 1. A detailed booking email to the administrator.
 * 2. A confirmation email to the customer.
 */
async function sendBookingEmails({ booking, bookingReference, formattedDate }) {
  const resend = new Resend(process.env.RESEND_API_KEY);

  const fromEmail =
    /*process.env.BOOKING_FROM_EMAIL;*/
    "Elite Städ Och Service <onboarding@resend.dev>";

  /*const adminEmail =
    process.env.ADMIN_EMAIL;*/
  const testRecipient = "lina_abuhijleh@hotmail.com";

  /*if (!fromEmail || !adminEmail) {
    throw new Error(
      "Email sender or administrator email is missing."
    );
  }*/

  /*
   * When BOOKING_TEST_EMAIL exists, both emails go
   * to the test address rather than real recipients.
   */
  /*const adminRecipient =
    testEmail || adminEmail;

  const clientRecipient =
    testEmail || booking.email;*/

  const adminEmailHtml = buildAdminEmailHtml({
    booking,
    bookingReference,
    formattedDate,
  });

  const clientEmailHtml = buildClientEmailHtml({
    booking,
    bookingReference,
    formattedDate,
  });

  const [adminEmailSent, clientEmailSent] = await Promise.all([
    sendEmailSafely({
      resend,
      emailType: "Admin",
      from: fromEmail,
      /*to: adminRecipient,*/
      to: testRecipient,
      subject: `Ny bokning: ${booking.name} – ` + formattedDate,
      html: adminEmailHtml,

      /*
       * Clicking Reply in the admin email
       * will reply directly to the customer.
       */
      /*replyTo: booking.email,*/
      replyTo: testRecipient,
    }),

    sendEmailSafely({
      resend,
      emailType: "Client",
      from: fromEmail,
      /*to: clientRecipient,*/
      to: testRecipient,
      subject: `Vi har tagit emot din bokning – ` + formattedDate,
      html: clientEmailHtml,

      /*
       * Clicking Reply in the client email
       * will reply to the business.
       */
      /*replyTo: adminEmail,*/
      replyTo: testRecipient,
    }),
  ]);

  return {
    adminEmailSent,
    clientEmailSent,
  };
}

/**
 * Sends a confirmation SMS to the customer.
 * SMS errors are caught here so that a failed SMS
 * does not remove an otherwise successful booking.
 */
async function sendConfirmationSms({
  booking,
  bookingReference,
  formattedDate,
}) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromPhone = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromPhone) {
    console.log("SMS skipped because Twilio is not configured.");
    return false;
  }

  const twilioClient = twilio(accountSid, authToken);

  const smsBody =
    `Hej ${booking.name}! ` +
    "Vi har tagit emot din bokningsförfrågan " +
    `hos Elite Städ Och Service för ${formattedDate}. ` +
    `Bokningsnummer: ${bookingReference}. ` +
    "Vi kontaktar dig inom 24 timmar för bekräftelse.";

  try {
    const message = await twilioClient.messages.create({
      from: fromPhone,
      to: booking.phone,
      body: smsBody,
    });
    console.log("SMS sent:", message.sid);
    return true;
  } catch (error) {
    console.error("SMS failed:", error);
    return false;
  }
}

/* =========================================================
   NETLIFY FUNCTION / HANDLER
   =========================================================*/

exports.handler = async function handler(event) {
  // Only allow POST requests
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, {
      error: "Method not allowed.",
    });
  }

  try {
    /* Validate server configuration */
    validateEnvironmentVariables();

    /* Parse request body*/
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return jsonResponse(400, {
        error: "Förfrågans innehåll är ogiltigt.",
      });
    }

    /* Create booking object */
    const booking = createBooking(body);

    /* Validate booking */
    const validationError = validateBooking(booking);
    if (validationError) {
      return jsonResponse(400, {
        error: validationError,
      });
    }

    /* Google Calendar */
    const calendar = getCalendarClient();

    // Double-check availability to prevent race conditions
    const bookingCount = await countBookingsForDate(
      calendar,
      booking.selectedDate,
    );

    if (bookingCount >= MAX_BOOKINGS_PER_DAY) {
      return jsonResponse(409, {
        error: "Datumet blev precis fullbokat. Välj ett annat datum.",
      });
    }

    /* Booking information */
    const formattedDate = formatSwedishDate(booking.selectedDate);

    const bookingReference = createBookingReference(booking.selectedDate);

    /* Create calendar event */
    await createCalendarEvent({
      calendar,
      booking,
      bookingReference,
      formattedDate,
    });

    /* Send emails */
    const { adminEmailSent, clientEmailSent } = await sendBookingEmails({
      booking,
      bookingReference,
      formattedDate,
    });

    /* Send SMS */
    const smsSent = await sendConfirmationSms({
      booking,
      bookingReference,
      formattedDate,
    });

    /* Success */
    return jsonResponse(200, {
      success: true,
      bookingReference,
      message: "Bokningen har tagits emot.",

      notifications: {
        adminEmailSent,
        clientEmailSent,
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
