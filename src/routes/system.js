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
  addLecturer,
  changePassword,
  getRoomHistory, // ✅ 1. Import
  listRoomsWithHistoryCount, // ✅ 2. Import
  listRoomsWithAllTimeSlots,
} = require("../controllers/system.js");

const router = Router();

// Rooms
router.get("/rooms", listRooms);
router.get("/rooms/all-slots-today", listRoomsWithAllTimeSlots);
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

// New route for adding lecturers
router.post("/lecturers", addLecturer);

// Route for changing password
router.put('/user/password', changePassword); 

// ✅ 3. Route for the main history page (Lecturer & Staff)
// e.g., /api/history/rooms?role=staff&userId=2
router.get("/history/rooms", listRoomsWithHistoryCount);

// ✅ 4. Route for the history detail page (Lecturer & Staff)
// e.g., /api/rooms/1/history?role=staff&userId=2
router.get("/rooms/:roomId/history", getRoomHistory);

module.exports = router;