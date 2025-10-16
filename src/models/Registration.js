const mongoose = require('mongoose');

const ticketSchema = new mongoose.Schema({
  ticketType: {
    type: String,
    required: true
  },
  price: {
    type: Number,
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  }
});

const registrationSchema = new mongoose.Schema({
  event: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  tickets: [ticketSchema],
  totalAmount: {
    type: Number,
    required: true
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'pending'
  },
  paymentIntentId: {
    type: String
  },
  transactionId: {
    type: String
  },
  status: {
    type: String,
    enum: ['active', 'cancelled', 'transferred'],
    default: 'active'
  },
  qrCode: {
    type: String
  },
  checkInStatus: {
    type: Boolean,
    default: false
  },
  checkInTime: Date,
  attendeeInfo: {
    name: String,
    email: String,
    phone: String,
    specialRequirements: String
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Registration', registrationSchema);