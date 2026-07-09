const monthTitle = document.getElementById("calendar-month");
const calendarDays = document.getElementById("calendar-days");
const slotsContainer = document.getElementById("available-slots");

const prevBtn = document.getElementById("prev-month");
const nextBtn = document.getElementById("next-month");

const bookingForm = document.querySelector(".booking-form");
const confirmation = document.querySelector("#booking-confirmation");

bookingForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!bookingForm.checkValidity()) {
    bookingForm.reportValidity();
    return;
  }

  confirmation.classList.add("show");
  bookingForm.reset();
});

document.querySelectorAll(".room-item").forEach((item) => {
  const minus = item.querySelector(".minus");
  const plus = item.querySelector(".plus");
  const count = item.querySelector(".count");

  plus.addEventListener("click", () => {
    count.textContent = Number(count.textContent) + 1;
  });

  minus.addEventListener("click", () => {
    const current = Number(count.textContent);

    if (current > 0) {
      count.textContent = current - 1;
    }
  });
});

// Example available times
// Later these will come from your backend/database.
const availableSlots = {
  "2026-07-15": ["08:00", "09:30", "11:00", "13:30", "15:00"],
  "2026-07-16": ["09:00", "10:30", "14:00"],
  "2026-07-17": ["08:30", "12:00", "16:00"]
};

let currentDate = new Date();

function formatDate(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function renderCalendar() {

  calendarDays.innerHTML = "";

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  monthTitle.textContent =
    currentDate.toLocaleDateString("sv-SE", {
      month: "long",
      year: "numeric"
    });

  const firstDay = new Date(year, month, 1);

  const lastDay = new Date(year, month + 1, 0).getDate();

  let startDay = firstDay.getDay();

  // Monday first
  startDay = startDay === 0 ? 6 : startDay - 1;

  for (let i = 0; i < startDay; i++) {
    calendarDays.innerHTML += "<div></div>";
  }

  for (let day = 1; day <= lastDay; day++) {

    const fullDate = formatDate(year, month, day);

    const button = document.createElement("button");

    button.className = "calendar-day";
    button.textContent = day;

    if (availableSlots[fullDate]) {

      button.classList.add("available");

      button.onclick = () => {

        document
          .querySelectorAll(".calendar-day")
          .forEach(d => d.classList.remove("selected"));

        button.classList.add("selected");

        showAvailableTimes(fullDate);

      };

    } else {

      button.classList.add("disabled");

    }

    calendarDays.appendChild(button);

  }

}

function showAvailableTimes(date) {

  slotsContainer.innerHTML = "";

  availableSlots[date].forEach(time => {

    const slot = document.createElement("button");

    slot.className = "slot";

    slot.textContent = time;

    slot.onclick = () => {

      document
        .querySelectorAll(".slot")
        .forEach(s => s.classList.remove("selected"));

      slot.classList.add("selected");

    };

    slotsContainer.appendChild(slot);

  });

}

prevBtn.onclick = () => {

  currentDate.setMonth(currentDate.getMonth() - 1);

  renderCalendar();

};

nextBtn.onclick = () => {

  currentDate.setMonth(currentDate.getMonth() + 1);

  renderCalendar();

};

renderCalendar();