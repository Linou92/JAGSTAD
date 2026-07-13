document.addEventListener("DOMContentLoaded", () => {
  /* =========================
     ELEMENTS
  ========================= */

  const monthTitle = document.getElementById("calendar-month");
  const calendarDays = document.getElementById("calendar-days");
  const slotsContainer = document.getElementById("available-slots");

  const prevBtn = document.getElementById("prev-month");
  const nextBtn = document.getElementById("next-month");

  const bookingForm = document.querySelector(".booking-form");
  const confirmation = document.getElementById("booking-confirmation");

  if (
    !monthTitle ||
    !calendarDays ||
    !slotsContainer ||
    !prevBtn ||
    !nextBtn
  ) {
    console.error("Calendar elements could not be found.");
    return;
  }

  /* =========================
     CALENDAR STATE
  ========================= */

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let currentDate = new Date(today.getFullYear(), today.getMonth(), 1);

  let selectedDate = null;
  let selectedSlot = null;

  /* =========================
     DATE HELPERS
  ========================= */

  function formatDate(year, month, day) {
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(
      day
    ).padStart(2, "0")}`;
  }

  function isPastDate(year, month, day) {
    const date = new Date(year, month, day);
    date.setHours(0, 0, 0, 0);

    return date < today;
  }

  function isCurrentMonth() {
    return (
      currentDate.getFullYear() === today.getFullYear() &&
      currentDate.getMonth() === today.getMonth()
    );
  }

  /* =========================
     RENDER CALENDAR
  ========================= */

  function renderCalendar() {
    calendarDays.innerHTML = "";

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    monthTitle.textContent = currentDate.toLocaleDateString("sv-SE", {
      month: "long",
      year: "numeric",
    });

    /*
     * Prevent users from navigating to months
     * before the current month.
     */
    prevBtn.disabled = isCurrentMonth();

    const firstDayOfMonth = new Date(year, month, 1);
    const numberOfDays = new Date(year, month + 1, 0).getDate();

    /*
     * JavaScript uses Sunday = 0.
     * This changes it so Monday becomes the first day.
     */
    let startOffset = firstDayOfMonth.getDay() - 1;

    if (startOffset < 0) {
      startOffset = 6;
    }

    /*
     * Add empty cells before day 1.
     */
    for (let i = 0; i < startOffset; i++) {
      const emptyCell = document.createElement("div");
      emptyCell.className = "calendar-empty";
      calendarDays.appendChild(emptyCell);
    }

    /*
     * Create each date button.
     */
    for (let day = 1; day <= numberOfDays; day++) {
      const fullDate = formatDate(year, month, day);

      const button = document.createElement("button");

      button.type = "button";
      button.className = "calendar-day";
      button.textContent = day;
      button.dataset.date = fullDate;

      if (isPastDate(year, month, day)) {
        button.classList.add("disabled");
        button.disabled = true;
      } else {
        button.classList.add("available");

        button.addEventListener("click", () => {
          selectDate(button, fullDate);
        });
      }

      if (fullDate === selectedDate) {
        button.classList.add("selected");
      }

      calendarDays.appendChild(button);
    }
  }

  /* =========================
     SELECT DATE
  ========================= */

  function selectDate(button, fullDate) {
    document.querySelectorAll(".calendar-day").forEach((dayButton) => {
      dayButton.classList.remove("selected");
    });

    button.classList.add("selected");

    selectedDate = fullDate;
    selectedSlot = null;

    loadAvailableTimes(fullDate);
  }

  /* =========================
     GOOGLE CALENDAR AVAILABILITY
  ========================= */

  async function loadAvailableTimes(date) {
    slotsContainer.innerHTML = `
      <p class="slot-message">
        Hämtar lediga tider...
      </p>
    `;

    try {
      const response = await fetch(
        `/.netlify/functions/get-availability?date=${encodeURIComponent(date)}`
      );

      /*
       * A Netlify error can sometimes return HTML instead
       * of JSON, so read the response safely.
       */
      const contentType = response.headers.get("content-type") || "";

      if (!contentType.includes("application/json")) {
        throw new Error(
          `Servern returnerade ett oväntat svar (${response.status}).`
        );
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Kunde inte hämta lediga tider.");
      }

      renderAvailableTimes(data.slots || []);
    } catch (error) {
      console.error("Availability error:", error);

      slotsContainer.innerHTML = `
        <p class="slot-message">
          Det gick inte att hämta lediga tider. Försök igen senare.
        </p>
      `;
    }
  }

  /* =========================
     RENDER TIME SLOTS
  ========================= */

  function renderAvailableTimes(slots) {
    slotsContainer.innerHTML = "";

    if (slots.length === 0) {
      slotsContainer.innerHTML = `
        <p class="slot-message">
          Det finns inga lediga tider för detta datum.
        </p>
      `;
      return;
    }

    slots.forEach((slotData) => {
      const slotButton = document.createElement("button");

      slotButton.type = "button";
      slotButton.className = "slot";
      slotButton.textContent = slotData.label;

      slotButton.dataset.start = slotData.start;
      slotButton.dataset.end = slotData.end;

      slotButton.addEventListener("click", () => {
        document.querySelectorAll(".slot").forEach((button) => {
          button.classList.remove("selected");
        });

        slotButton.classList.add("selected");

        selectedSlot = {
          start: slotData.start,
          end: slotData.end,
          label: slotData.label,
        };
      });

      slotsContainer.appendChild(slotButton);
    });
  }

  /* =========================
     MONTH NAVIGATION
  ========================= */

  prevBtn.addEventListener("click", () => {
    if (isCurrentMonth()) {
      return;
    }

    currentDate = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth() - 1,
      1
    );

    selectedDate = null;
    selectedSlot = null;

    resetSlotsMessage();
    renderCalendar();
  });

  nextBtn.addEventListener("click", () => {
    currentDate = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth() + 1,
      1
    );

    selectedDate = null;
    selectedSlot = null;

    resetSlotsMessage();
    renderCalendar();
  });

  function resetSlotsMessage() {
    slotsContainer.innerHTML = `
      <p class="slot-message">
        Välj ett datum för att se lediga tider.
      </p>
    `;
  }

  /* =========================
     ROOM COUNTERS
  ========================= */

  document.querySelectorAll(".room-item").forEach((item) => {
    const checkbox = item.querySelector('input[type="checkbox"]');
    const minusButton = item.querySelector(".minus");
    const plusButton = item.querySelector(".plus");
    const countElement = item.querySelector(".count");

    if (!minusButton || !plusButton || !countElement) {
      return;
    }

    function setCount(value) {
      const safeValue = Math.max(0, value);

      countElement.textContent = String(safeValue);

      /*
       * Selecting a quantity automatically checks the room.
       * Returning to zero automatically unchecks it.
       */
      if (checkbox) {
        checkbox.checked = safeValue > 0;
      }
    }

    plusButton.addEventListener("click", () => {
      const currentCount = Number(countElement.textContent) || 0;
      setCount(currentCount + 1);
    });

    minusButton.addEventListener("click", () => {
      const currentCount = Number(countElement.textContent) || 0;
      setCount(currentCount - 1);
    });

    checkbox?.addEventListener("change", () => {
      const currentCount = Number(countElement.textContent) || 0;

      if (checkbox.checked && currentCount === 0) {
        setCount(1);
      }

      if (!checkbox.checked) {
        setCount(0);
      }
    });
  });

  /* =========================
     FORM SUBMISSION
  ========================= */

  bookingForm?.addEventListener("submit", (event) => {
    event.preventDefault();

    confirmation?.classList.remove("show");

    if (!bookingForm.checkValidity()) {
      bookingForm.reportValidity();
      return;
    }

    if (!selectedDate) {
      showCalendarError("Välj ett datum innan du skickar förfrågan.");
      return;
    }

    if (!selectedSlot) {
      showCalendarError("Välj en ledig tid innan du skickar förfrågan.");
      return;
    }

    /*
     * For now this only validates the form and displays
     * the confirmation. It does not create a Google
     * Calendar event yet.
     */
    console.log("Booking data:", {
      date: selectedDate,
      slot: selectedSlot,
    });

    confirmation?.classList.add("show");

    bookingForm.reset();
    resetRoomCounters();

    selectedDate = null;
    selectedSlot = null;

    resetSlotsMessage();
    renderCalendar();

    confirmation?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  });

  function showCalendarError(message) {
    slotsContainer.innerHTML = `
      <p class="slot-message slot-message--error">
        ${message}
      </p>
    `;

    slotsContainer.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }

  function resetRoomCounters() {
    document.querySelectorAll(".room-item").forEach((item) => {
      const checkbox = item.querySelector('input[type="checkbox"]');
      const countElement = item.querySelector(".count");

      if (checkbox) {
        checkbox.checked = false;
      }

      if (countElement) {
        countElement.textContent = "0";
      }
    });
  }

  /* =========================
     INITIALIZE
  ========================= */

  renderCalendar();
});