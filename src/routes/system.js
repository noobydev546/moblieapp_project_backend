const { Router } = require("express");
const {
  listRooms,
  getRoom,
  createRoom,
  updateRoom,
  deleteRoom,
  listTimeSlots,
  createBooking,
  listUserBookings,
  approveBooking,
  addLecturer, // <-- ADDED: Import addLecturer
} = require("../controllers/system.js");

const router = Router();

// Rooms
router.get("/rooms", listRooms);
router.get("/rooms/:id", getRoom);
router.post("/rooms", createRoom);
router.put("/rooms/:id", updateRoom);
router.delete("/rooms/:id", deleteRoom);

// Time slots for a room
router.get("/rooms/:roomId/slots", listTimeSlots);

// Bookings
router.post("/bookings", createBooking);
router.get("/bookings/user/:userId", listUserBookings);
router.post("/bookings/:history_id/approve", approveBooking);

// <-- ADDED: New route for adding lecturers -->
router.post("/lecturers", addLecturer);

module.exports = router;
