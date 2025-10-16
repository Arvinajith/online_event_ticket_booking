const express = require('express');
const router = express.Router();
const Registration = require('../models/Registration');
const Event = require('../models/Event');
const { protect } = require('../middleware/auth');
const QRCode = require('qrcode');

// @route   POST /api/registrations
// @desc    Create new registration
// @access  Private
router.post('/', protect, async (req, res) => {
  try {
    const { eventId, tickets, attendeeInfo } = req.body;

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    // Calculate total amount and validate ticket availability
    let totalAmount = 0;
    for (const ticket of tickets) {
      const ticketType = event.ticketTypes.find(tt => tt.name === ticket.ticketType);
      if (!ticketType) {
        return res.status(400).json({ message: `Invalid ticket type: ${ticket.ticketType}` });
      }
      if (ticketType.quantity - ticketType.sold < ticket.quantity) {
        return res.status(400).json({ message: `Not enough tickets available for ${ticket.ticketType}` });
      }
      totalAmount += ticketType.price * ticket.quantity;
    }

    // Create registration
    const registration = await Registration.create({
      event: eventId,
      user: req.user.id,
      tickets: tickets.map(t => ({
        ticketType: t.ticketType,
        price: event.ticketTypes.find(tt => tt.name === t.ticketType).price,
        quantity: t.quantity
      })),
      totalAmount,
      attendeeInfo,
      paymentStatus: 'pending'
    });

    // Generate QR Code
    const qrData = JSON.stringify({
      registrationId: registration._id,
      eventId: event._id,
      userId: req.user.id
    });
    const qrCode = await QRCode.toDataURL(qrData);
    registration.qrCode = qrCode;
    await registration.save();

    res.status(201).json(registration);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/registrations/my-registrations
// @desc    Get user's registrations
// @access  Private
router.get('/my-registrations', protect, async (req, res) => {
  try {
    const registrations = await Registration.find({ user: req.user.id })
      .populate('event')
      .sort({ createdAt: -1 });

    res.json(registrations);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/registrations/:id
// @desc    Get single registration
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const registration = await Registration.findById(req.params.id)
      .populate('event')
      .populate('user', 'name email phone');

    if (!registration) {
      return res.status(404).json({ message: 'Registration not found' });
    }

    // Check if user owns this registration or is organizer/admin
    const event = await Event.findById(registration.event._id);
    if (
      registration.user._id.toString() !== req.user.id &&
      event.organizer.toString() !== req.user.id &&
      req.user.role !== 'admin'
    ) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    res.json(registration);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   PUT /api/registrations/:id/payment
// @desc    Update payment status
// @access  Private
router.put('/:id/payment', protect, async (req, res) => {
  try {
    const { paymentIntentId, transactionId } = req.body;

    const registration = await Registration.findById(req.params.id);
    if (!registration) {
      return res.status(404).json({ message: 'Registration not found' });
    }

    if (registration.user.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    registration.paymentStatus = 'completed';
    registration.paymentIntentId = paymentIntentId;
    registration.transactionId = transactionId;

    await registration.save();

    // Update event analytics
    const event = await Event.findById(registration.event);
    const totalTickets = registration.tickets.reduce((sum, t) => sum + t.quantity, 0);
    
    event.analytics.totalTicketsSold += totalTickets;
    event.analytics.totalRevenue += registration.totalAmount;
    event.attendees.push(registration._id);

    // Update ticket type sold count
    for (const ticket of registration.tickets) {
      const ticketType = event.ticketTypes.find(tt => tt.name === ticket.ticketType);
      if (ticketType) {
        ticketType.sold += ticket.quantity;
      }
    }

    await event.save();

    res.json(registration);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   PUT /api/registrations/:id/cancel
// @desc    Cancel registration
// @access  Private
router.put('/:id/cancel', protect, async (req, res) => {
  try {
    const registration = await Registration.findById(req.params.id);
    
    if (!registration) {
      return res.status(404).json({ message: 'Registration not found' });
    }

    if (registration.user.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (registration.status === 'cancelled') {
      return res.status(400).json({ message: 'Registration already cancelled' });
    }

    registration.status = 'cancelled';
    await registration.save();

    // Update event analytics
    const event = await Event.findById(registration.event);
    const totalTickets = registration.tickets.reduce((sum, t) => sum + t.quantity, 0);
    
    event.analytics.totalTicketsSold -= totalTickets;
    event.analytics.totalRevenue -= registration.totalAmount;
    event.attendees = event.attendees.filter(a => a.toString() !== registration._id.toString());

    // Update ticket type sold count
    for (const ticket of registration.tickets) {
      const ticketType = event.ticketTypes.find(tt => tt.name === ticket.ticketType);
      if (ticketType) {
        ticketType.sold -= ticket.quantity;
      }
    }

    await event.save();

    res.json({ message: 'Registration cancelled successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/registrations/event/:eventId
// @desc    Get all registrations for an event
// @access  Private (Organizer/Admin)
router.get('/event/:eventId', protect, async (req, res) => {
  try {
    const event = await Event.findById(req.params.eventId);
    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    // Check if user is organizer or admin
    if (event.organizer.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const registrations = await Registration.find({ 
      event: req.params.eventId,
      paymentStatus: 'completed'
    })
      .populate('user', 'name email phone')
      .sort({ createdAt: -1 });

    res.json(registrations);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;