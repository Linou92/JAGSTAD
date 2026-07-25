const { google } = require("googleapis");

function getCalendarClient() {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");


    console.log({
    email: clientEmail,
    keyExists: !!privateKey,
    keyStartsCorrectly: privateKey?.startsWith("-----BEGIN PRIVATE KEY-----"),
    keyEndsCorrectly: privateKey?.trim().endsWith("-----END PRIVATE KEY-----"),
    keyLength: privateKey?.length,
  });

  
  if (!clientEmail || !privateKey) {
    throw new Error("Google Calendar credentials are missing.");
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: [
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.freebusy",
    ],
  });

  return google.calendar({
    version: "v3",
    auth,
  });
}

module.exports = {
  getCalendarClient,
};