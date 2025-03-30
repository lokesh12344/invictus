import express from 'express';
import cors from 'cors';
import twilio from 'twilio';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// JWT secret key (in a real app, this would be in .env)
const JWT_SECRET = 'your-secret-key';

// In-memory user store (in a real app, this would be a database)
const users = new Map();

// Authentication endpoints
app.post('/api/auth/signup', (req, res) => {
  const { name, email, password, age, gender, patientName, guardianPhone } = req.body;

  // Validate input
  if (!name || !email || !password || !age || !gender || !patientName || !guardianPhone) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  // Validate phone number format
  if (!guardianPhone.startsWith('+')) {
    return res.status(400).json({
      message: 'Phone number must start with + and country code'
    });
  }

  // Check if user already exists
  if (Array.from(users.values()).some(user => user.email === email)) {
    return res.status(400).json({ message: 'Email already registered' });
  }

  // Create new user
  const user = {
    id: Date.now().toString(),
    name,
    email,
    password, // In a real app, this would be hashed
    age,
    gender,
    patientName,
    guardianPhone
  };

  // Store user
  users.set(user.id, user);

  // Generate JWT
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '24h' });

  // Return user data (excluding password) and token
  const { password: _, ...userWithoutPassword } = user;
  res.status(201).json({
    user: userWithoutPassword,
    token
  });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;

  // Validate input
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  // Find user
  const user = Array.from(users.values()).find(u => u.email === email);

  // Check if user exists and password matches
  if (!user || user.password !== password) { // In a real app, you'd use proper password comparison
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  // Generate JWT
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '24h' });

  // Return user data (excluding password) and token
  const { password: _, ...userWithoutPassword } = user;
  res.json({
    user: userWithoutPassword,
    token
  });
});

// Initialize Twilio client with error handling
let twilioClient = null;
try {
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    console.log('Twilio client initialized successfully');
    console.log('Using Twilio phone number:', process.env.TWILIO_PHONE_NUMBER);
  } else {
    console.log('Twilio credentials not found. SMS notifications will be disabled.');
  }
} catch (error) {
  console.error('Error initializing Twilio client:', error.message);
  console.log('SMS notifications will be disabled.');
}

// Store active reminders and their timers
const activeReminders = new Map();
const allReminders = new Map();  // Store all reminders, even after they're taken

// Test endpoint to verify SMS functionality
app.post('/api/test-sms', async (req, res) => {
  const { phoneNumber } = req.body;
  
  console.log('Attempting to send test SMS to:', phoneNumber);
  
  if (!twilioClient) {
    console.error('Test SMS failed: Twilio client not initialized');
    return res.status(500).json({ 
      error: 'Twilio client not initialized' 
    });
  }

  try {
    const message = await twilioClient.messages.create({
      body: 'This is a test message from your Medicine Reminder App. If you receive this, SMS notifications are working correctly!',
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phoneNumber
    });
    
    console.log('Test SMS sent successfully. Message SID:', message.sid);
    res.json({ message: 'Test SMS sent successfully', messageSid: message.sid });
  } catch (error) {
    console.error('Error sending test SMS:', error.message);
    console.error('Error details:', error);
    res.status(500).json({ 
      error: 'Failed to send SMS',
      details: error.message,
      code: error.code
    });
  }
});

// Immediate test endpoint (no timer)
app.post('/api/immediate-test-sms', async (req, res) => {
  const { phoneNumber } = req.body;
  
  console.log('Attempting immediate test SMS to:', phoneNumber);
  console.log('Using Twilio number:', process.env.TWILIO_PHONE_NUMBER);
  
  if (!twilioClient) {
    console.error('Immediate test failed: Twilio client not initialized');
    return res.status(500).json({ 
      error: 'Twilio client not initialized',
      twilioStatus: {
        accountSid: process.env.TWILIO_ACCOUNT_SID ? 'Set' : 'Not set',
        authToken: process.env.TWILIO_AUTH_TOKEN ? 'Set' : 'Not set',
        phoneNumber: process.env.TWILIO_PHONE_NUMBER
      }
    });
  }

  try {
    // Validate phone number format
    if (!phoneNumber.startsWith('+')) {
      return res.status(400).json({
        error: 'Invalid phone number format',
        message: 'Phone number must start with + and country code (e.g., +1 for US)'
      });
    }

    const message = await twilioClient.messages.create({
      body: `Test message sent at ${new Date().toLocaleTimeString()}. If you receive this, your medicine reminder SMS notifications are working!`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phoneNumber
    });
    
    console.log('Immediate test SMS sent successfully. Message SID:', message.sid);
    res.json({ 
      message: 'Test SMS sent successfully', 
      messageSid: message.sid,
      details: {
        to: phoneNumber,
        from: process.env.TWILIO_PHONE_NUMBER,
        status: message.status
      }
    });
  } catch (error) {
    console.error('Error sending immediate test SMS:', error.message);
    console.error('Error code:', error.code);
    console.error('Error details:', error);
    res.status(500).json({ 
      error: 'Failed to send SMS',
      details: error.message,
      code: error.code,
      twilioError: error.code
    });
  }
});

// Simple test endpoint for direct SMS testing
app.get('/api/test-sms/:phoneNumber', async (req, res) => {
  const phoneNumber = req.params.phoneNumber;
  
  console.log('Testing SMS with phone:', phoneNumber);
  console.log('Twilio number being used:', process.env.TWILIO_PHONE_NUMBER);
  
  try {
    const message = await twilioClient.messages.create({
      body: 'Test SMS from Medicine Reminder App',
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phoneNumber
    });
    
    console.log('Test SMS Result:', {
      sid: message.sid,
      status: message.status,
      error: message.errorMessage
    });
    
    res.json({ success: true, messageId: message.sid });
  } catch (error) {
    console.error('SMS Test Error:', {
      message: error.message,
      code: error.code,
      status: error.status,
      moreInfo: error.moreInfo
    });
    res.status(500).json({ error: error.message });
  }
});

// Endpoint to add a new reminder with guardian phone
app.post('/api/reminders', (req, res) => {
  const { reminderId, medicineName, guardianPhone, time } = req.body;
  
  console.log('Setting up reminder:', {
    reminderId,
    medicineName,
    guardianPhone,
    time,
    type: typeof reminderId
  });
  
  if (!reminderId) {
    console.error('Missing reminder ID');
    return res.status(400).json({ message: 'Missing reminder ID' });
  }

  // Store in allReminders first
  allReminders.set(reminderId, {
    medicineName,
    guardianPhone,
    time,
    status: 'active',
    createdAt: new Date().toISOString()
  });

  // Validate phone number format
  if (!guardianPhone.startsWith('+')) {
    console.error('Invalid phone number format:', guardianPhone);
    return res.status(400).json({
      error: 'Invalid phone number format',
      message: 'Phone number must start with + and country code (e.g., +1 for US)'
    });
  }

  // For testing: Set timer to 10 seconds in development
  const TIMER_DURATION = process.env.NODE_ENV === 'development' ? 10000 : 5 * 60 * 1000;
  console.log(`Setting timer for ${TIMER_DURATION/1000} seconds`);

  // Clear any existing timer for this reminder
  if (activeReminders.has(reminderId)) {
    console.log('Clearing existing timer for reminder:', reminderId);
    clearTimeout(activeReminders.get(reminderId).timer);
  }

  const startTime = Date.now();
  console.log(`Setting timer for reminder ${reminderId} at ${new Date().toLocaleTimeString()}`);

  // Create timer reference
  const timerRef = {
    timer: null,
    triggered: false
  };

  // Set the timer
  timerRef.timer = setTimeout(async () => {
    const elapsedTime = (Date.now() - startTime) / 1000;
    console.log(`Timer triggered after ${elapsedTime} seconds for reminder:`, reminderId);
    
    // Prevent duplicate triggers
    if (timerRef.triggered) {
      console.log('Timer already triggered, skipping...');
      return;
    }
    timerRef.triggered = true;

    try {
      if (!twilioClient) {
        throw new Error('Twilio client not initialized');
      }

      console.log('Attempting to send SMS to guardian:', guardianPhone);
      console.log('Using Twilio number:', process.env.TWILIO_PHONE_NUMBER);
      
      // Send SMS to guardian
      const message = await twilioClient.messages.create({
        body: `Alert: Your loved one has not taken their ${medicineName} medication which was scheduled for ${time}. Please check on them.`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: guardianPhone
      });
      
      console.log('SMS sent successfully. Details:', {
        messageSid: message.sid,
        status: message.status,
        to: guardianPhone,
        from: process.env.TWILIO_PHONE_NUMBER
      });
    } catch (error) {
      console.error('Error sending SMS to guardian:', {
        error: error.message,
        code: error.code,
        moreInfo: error.moreInfo,
        status: error.status
      });
    } finally {
      console.log('Removing reminder from active reminders:', reminderId);
      activeReminders.delete(reminderId);
    }
  }, TIMER_DURATION);

  // Store timer info with additional debug info
  activeReminders.set(reminderId, {
    timer: timerRef.timer,
    medicineName,
    guardianPhone,
    time,
    startTime: new Date().toLocaleTimeString(),
    scheduledTime: new Date(Date.now() + TIMER_DURATION).toLocaleTimeString(),
    debug: {
      timerDuration: TIMER_DURATION,
      reminderId: reminderId,
      reminderIdType: typeof reminderId
    }
  });

  console.log('Active reminders after setting:', {
    count: activeReminders.size,
    reminders: Array.from(activeReminders.entries()).map(([id, data]) => ({
      id,
      medicineName: data.medicineName,
      startTime: data.startTime,
      scheduledTime: data.scheduledTime,
      debug: data.debug
    }))
  });

  res.json({ 
    message: 'Reminder timer set successfully',
    details: {
      reminderId,
      startTime: new Date().toLocaleTimeString(),
      scheduledSMSTime: new Date(Date.now() + TIMER_DURATION).toLocaleTimeString()
    }
  });
});

// Endpoint to cancel timer when medicine is taken
app.post('/api/reminders/:reminderId/taken', (req, res) => {
  const { reminderId } = req.params;
  
  console.log('Attempting to mark reminder as taken:', reminderId);
  console.log('Active reminders:', Array.from(activeReminders.keys()));
  console.log('All reminders:', Array.from(allReminders.keys()));
  
  if (!reminderId) {
    console.error('Invalid reminder ID provided');
    return res.status(400).json({ message: 'Invalid reminder ID' });
  }

  // Check if reminder exists in allReminders
  if (!allReminders.has(reminderId)) {
    console.log('Reminder not found in all reminders');
    return res.status(404).json({ 
      message: 'Reminder not found',
      reminderId: reminderId
    });
  }

  // Update reminder status
  const reminderData = allReminders.get(reminderId);
  reminderData.status = 'taken';
  reminderData.takenAt = new Date().toISOString();
  allReminders.set(reminderId, reminderData);

  // If reminder is still active, cancel its timer
  if (activeReminders.has(reminderId)) {
    try {
      console.log('Found active reminder, cancelling timer:', reminderId);
      const activeReminderData = activeReminders.get(reminderId);
      clearTimeout(activeReminderData.timer);
      activeReminders.delete(reminderId);
      console.log('Timer cancelled successfully');
    } catch (error) {
      console.error('Error while cancelling timer:', error);
      // Continue processing even if timer cancellation fails
    }
  }

  console.log('Reminder marked as taken successfully');
  res.json({ 
    message: 'Reminder marked as taken successfully',
    reminderId: reminderId,
    status: 'taken',
    takenAt: reminderData.takenAt
  });
});

// New endpoint to get all reminders
app.get('/api/reminders', (req, res) => {
  const remindersArray = Array.from(allReminders.entries()).map(([id, data]) => ({
    id,
    ...data
  }));
  res.json(remindersArray);
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Environment check:');
  console.log('- TWILIO_ACCOUNT_SID:', process.env.TWILIO_ACCOUNT_SID ? 'Set' : 'Not set');
  console.log('- TWILIO_AUTH_TOKEN:', process.env.TWILIO_AUTH_TOKEN ? 'Set' : 'Not set');
  console.log('- TWILIO_PHONE_NUMBER:', process.env.TWILIO_PHONE_NUMBER);
}); 