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
} = require("../controllers/system.js");

// --- 1. IMPORT THE MIDDLEWARE (use existing midleware folder)
const verifyToken = require("../midleware/authMiddleware.js");

const router = Router();

// --- PUBLIC ROUTES (No token needed) ---
// Anyone can see the list of rooms, room details, and available slots
router.get("/rooms", listRooms);
// router.get("/rooms/all-slots-today", listRoomsWithAllTimeSlots); // not implemented
router.get("/rooms/:id", getRoom);
router.get("/rooms/:roomId/slots", listTimeSlots);


// --- PROTECTED ROUTES (Token REQUIRED) ---
// verifyToken will run first to check if the user is logged in.

// Rooms (Must be logged in)
router.post("/rooms", verifyToken, createRoom);
router.put("/rooms/:id", verifyToken, updateRoom);
router.delete("/rooms/:id", verifyToken, deleteRoom);

// Bookings (Must be logged in)
router.post("/bookings", verifyToken, createBooking);
router.get("/bookings/user/:userId", verifyToken, listUserBookings); // Note: The controller now ignores :userId and uses the token
router.post("/bookings/:history_id/approve", verifyToken, approveBooking);

// User Management (Must be logged in)
// router.post("/lecturers", verifyToken, addLecturer); // not implemented
// router.put('/user/password', verifyToken, changePassword); // not implemented

// History (Must be logged in)
// router.get("/history/rooms", verifyToken, listRoomsWithHistoryCount); // not implemented
// router.get("/rooms/:roomId/history", verifyToken, getRoomHistory); // not implemented

module.exports = router;