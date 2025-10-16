const express = require('express');
const router = express.Router();
const Event = require('../models/Event');
const { protect, authorize } = require('../middleware/auth');

// @route   GET /api/events
// @desc    Get all events with filters
// @access  Public
router.get('/', async (req, res) => {
  try {
    const { 
      category, 
      city, 
      startDate, 
      endDate, 
      minPrice, 
      maxPrice, 
      search,
      status,
      page = 1,
      limit = 12
    } = req.query;

    let query = { status: 'published', isApproved: true };

    // Apply filters
    if (category) query.category = category;
    if (city) query['location.city'] = new RegExp(city, 'i');
    if (startDate) query.startDate = { $gte: new Date(startDate) };
    if (endDate) query.endDate = { $lte: new Date(endDate) };
    if (search) query.$text = { $search: search };

    // Price filter
    if (minPrice || maxPrice) {
      query['ticketTypes.price'] = {};
      if (minPrice) query['ticketTypes.price'].$gte = Number(minPrice);
      if (maxPrice) query['ticketTypes.price'].$lte = Number(maxPrice);
    }

    const events = await Event.find(query)
      .populate('organizer', 'name email')
      .sort({ startDate: 1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const count = await Event.countDocuments(query);

    res.json({
      events,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
      total: count
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/events/:id
// @desc    Get single event
// @access  Public
router.get('/:id', async (req, res) => {
  try {
    const event = await Event.findById(req.params.id)
      .populate('organizer', 'name email phone profileImage')
      .populate({
        path: 'attendees',
        populate: { path: 'user', select: 'name email' }
      });

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    // Increment views
    event.analytics.views += 1;
    await event.save();

    res.json(event);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST /api/events
// @desc    Create new event
// @access  Private (Organizer/Admin)
router.post('/', protect, authorize('organizer', 'admin'), async (req, res) => {
  try {
    const eventData = {
      ...req.body,
      organizer: req.user.id
    };

    const event = await Event.create(eventData);

    res.status(201).json(event);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   PUT /api/events/:id
// @desc    Update event
// @access  Private (Organizer/Admin)
router.put('/:id', protect, authorize('organizer', 'admin'), async (req, res) => {
  try {
    let event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    // Check ownership
    if (event.organizer.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    event = await Event.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    });

    res.json(event);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   DELETE /api/events/:id
// @desc    Delete event
// @access  Private (Organizer/Admin)
router.delete('/:id', protect, authorize('organizer', 'admin'), async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    // Check ownership
    if (event.organizer.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    await event.deleteOne();

    res.json({ message: 'Event removed' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/events/organizer/my-events
// @desc    Get organizer's events
// @access  Private
router.get('/organizer/my-events', protect, async (req, res) => {
  try {
    const events = await Event.find({ organizer: req.user.id })
      .sort({ createdAt: -1 });

    res.json(events);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/events/:id/analytics
// @desc    Get event analytics
// @access  Private (Organizer/Admin)
router.get('/:id/analytics', protect, authorize('organizer', 'admin'), async (req, res) => {
  try {
    const event = await Event.findById(req.params.id)
      .populate('attendees');

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    // Check ownership
    if (event.organizer.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const analytics = {
      totalViews: event.analytics.views,
      totalTicketsSold: event.analytics.totalTicketsSold,
      totalRevenue: event.analytics.totalRevenue,
      attendeeCount: event.attendees.length,
      ticketTypeBreakdown: event.ticketTypes.map(tt => ({
        name: tt.name,
        sold: tt.sold,
        remaining: tt.quantity - tt.sold,
        revenue: tt.sold * tt.price
      })),
      capacity: event.totalCapacity,
      occupancyRate: ((event.analytics.totalTicketsSold / event.totalCapacity) * 100).toFixed(2)
    };

    res.json(analytics);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;