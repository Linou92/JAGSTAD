document.addEventListener("DOMContentLoaded", () => {
  const monthTitle = document.getElementById("calendar-month");
  const calendarDays = document.getElementById("calendar-days");

  const prevBtn = document.getElementById("prev-month");
  const nextBtn = document.getElementById("next-month");

  const selectedDateMessage = document.getElementById(
    "selected-date-message"
  );

  if (
    !monthTitle ||
    !calendarDays ||
    !prevBtn ||
    !nextBtn ||
    !selectedDateMessage
  ) {
    console.error("Calendar HTML elements are missing.", {
      monthTitle,
      calendarDays,
      prevBtn,
      nextBtn,
      selectedDateMessage,
    });

    return;
  }

  const bookingForm = document.querySelector(".booking-form");
  const confirmation = document.getElementById(
    "booking-confirmation"
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let currentMonth = new Date(
    today.getFullYear(),
    today.getMonth(),
    1
  );

  let monthAvailability = new Map();
  let selectedDate = null;

  function formatDate(year, month, day) {
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(
      day
    ).padStart(2, "0")}`;
  }

  function formatMonth(date) {
    return `${date.getFullYear()}-${String(
      date.getMonth() + 1
    ).padStart(2, "0")}`;
  }

  function isCurrentMonth() {
    return (
      currentMonth.getFullYear() === today.getFullYear() &&
      currentMonth.getMonth() === today.getMonth()
    );
  }

async function loadMonthAvailability() {
  /*
   * First render all dates as disabled/loading.
   * This prevents the calendar from appearing empty
   * while Netlify is loading.
   */
  monthAvailability = new Map();
  renderCalendar(true);

  try {
    const month = formatMonth(currentMonth);

    const response = await fetch(
      `/.netlify/functions/get-availability?month=${encodeURIComponent(
        month
      )}`
    );

    const contentType =
      response.headers.get("content-type") || "";

    if (!contentType.includes("application/json")) {
      const responseText = await response.text();

      console.error("Unexpected server response:", responseText);

      throw new Error(
        `Servern returnerade ett oväntat svar (${response.status}).`
      );
    }

    const data = await response.json();

    console.log("Availability response:", data);

    if (!response.ok) {
      throw new Error(
        data.error || "Kunde inte hämta lediga dagar."
      );
    }

    monthAvailability = new Map();

    /*
     * Available days returned as objects:
     *
     * {
     *   date: "2026-08-10",
     *   bookingCount: 1,
     *   remainingBookings: 1
     * }
     */
    data.availableDays?.forEach((day) => {
      monthAvailability.set(day.date, {
        available: true,
        bookingCount: day.bookingCount || 0,
        remainingBookings: day.remainingBookings || 0,
      });
    });

    /*
     * This supports both possible backend formats:
     *
     * "2026-08-10"
     *
     * or:
     *
     * {
     *   date: "2026-08-10",
     *   bookingCount: 2
     * }
     */
    data.unavailableDays?.forEach((day) => {
      const date =
        typeof day === "string"
          ? day
          : day.date;

      const bookingCount =
        typeof day === "string"
          ? 0
          : day.bookingCount || 0;

      if (!date) {
        return;
      }

      monthAvailability.set(date, {
        available: false,
        bookingCount,
        remainingBookings: 0,
      });
    });

    renderCalendar(false);
  } catch (error) {
    console.error("Availability error:", error);

    /*
     * Still show the month dates, but disable them
     * because availability could not be verified.
     */
    monthAvailability = new Map();
    renderCalendar(false, true);

    selectedDateMessage.textContent =
      "Det gick inte att hämta lediga dagar. Försök igen senare.";

    selectedDateMessage.classList.add("calendar-error");
  }
}

function renderCalendar(isLoading = false, hasError = false) {
  calendarDays.innerHTML = "";

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  monthTitle.textContent =
    currentMonth.toLocaleDateString("sv-SE", {
      month: "long",
      year: "numeric",
    });

  prevBtn.disabled = isCurrentMonth();

  const firstDay = new Date(year, month, 1);
  const lastDate = new Date(
    year,
    month + 1,
    0
  ).getDate();

  /*
   * JavaScript:
   * Sunday = 0
   * Monday = 1
   *
   * Calendar:
   * Monday should be first.
   */
  let startOffset = firstDay.getDay() - 1;

  if (startOffset < 0) {
    startOffset = 6;
  }

  for (let index = 0; index < startOffset; index++) {
    const emptyCell = document.createElement("div");
    emptyCell.className = "calendar-empty";
    calendarDays.appendChild(emptyCell);
  }

  for (let day = 1; day <= lastDate; day++) {
    const fullDate = formatDate(year, month, day);
    const availability =
      monthAvailability.get(fullDate);

    const button = document.createElement("button");

    button.type = "button";
    button.className = "calendar-day";
    button.textContent = day;
    button.dataset.date = fullDate;

    if (isLoading) {
      button.classList.add("loading");
      button.disabled = true;
      button.title = "Hämtar tillgänglighet";
    } else if (hasError) {
      button.classList.add("unavailable");
      button.disabled = true;
      button.title =
        "Tillgängligheten kunde inte kontrolleras";
    } else if (availability?.available) {
      button.classList.add("available");

      button.title =
        availability.remainingBookings === 1
          ? "1 bokning kvar denna dag"
          : "2 bokningar kvar denna dag";

      button.addEventListener("click", () => {
        selectDate(button, fullDate);
      });
    } else {
      button.classList.add("unavailable");
      button.disabled = true;

      button.title =
        availability?.bookingCount >= 2
          ? "Fullbokad"
          : "Inte tillgänglig";
    }

    if (fullDate === selectedDate) {
      button.classList.add("selected");
    }

    calendarDays.appendChild(button);
  }
}

  function selectDate(button, fullDate) {
    document.querySelectorAll(".calendar-day").forEach(
      (dayButton) => {
        dayButton.classList.remove("selected");
      }
    );

    button.classList.add("selected");
    selectedDate = fullDate;

    const readableDate = new Date(
      `${fullDate}T12:00:00`
    ).toLocaleDateString("sv-SE", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    selectedDateMessage.textContent =
      `Vald dag: ${readableDate}`;

    selectedDateMessage.classList.add("has-selection");
  }

  prevBtn.addEventListener("click", () => {
    if (isCurrentMonth()) {
      return;
    }

    currentMonth = new Date(
      currentMonth.getFullYear(),
      currentMonth.getMonth() - 1,
      1
    );

    selectedDate = null;
    resetSelectedDateMessage();
    loadMonthAvailability();
  });

  nextBtn.addEventListener("click", () => {
    currentMonth = new Date(
      currentMonth.getFullYear(),
      currentMonth.getMonth() + 1,
      1
    );

    selectedDate = null;
    resetSelectedDateMessage();
    loadMonthAvailability();
  });

  function resetSelectedDateMessage() {
    selectedDateMessage.textContent = "Ingen dag är vald.";
    selectedDateMessage.classList.remove("has-selection");
  }

  bookingForm?.addEventListener("submit", (event) => {
    event.preventDefault();

    confirmation?.classList.remove("show");

    if (!bookingForm.checkValidity()) {
      bookingForm.reportValidity();
      return;
    }

    if (!selectedDate) {
      selectedDateMessage.textContent =
        "Välj en ledig dag innan du skickar förfrågan.";

      selectedDateMessage.classList.add("has-selection");

      selectedDateMessage.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });

      return;
    }

    console.log("Selected booking day:", selectedDate);

    /*
     * Later, send selectedDate to create-booking.
     * The backend must choose the first available
     * slot for that day.
     */
  });

  loadMonthAvailability();
});