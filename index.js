// server.js (blood-donation backend) - FIXED FOR VERCEL

const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 3000;

// Firebase Admin
const admin = require("firebase-admin");

// Initialize Firebase only once
if (!admin.apps.length) {
  const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8');
  const serviceAccount = JSON.parse(decoded);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

// Middleware - MUST be before routes
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// MongoDB Connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ifwcykr.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Stripe
const stripe = require('stripe')(process.env.STRIPE_SECRET);

// Database and Collections - will be initialized on first request
let db, usersCollection, DonationCollection, fundingCollection;

// Connect to DB (cached connection for serverless)
async function connectDB() {
  if (db) return db;
  
  try {
    await client.connect();
    db = client.db('redHope_db');
    usersCollection = db.collection('users');
    DonationCollection = db.collection('donation-requests');
    fundingCollection = db.collection('fundings');
    console.log('MongoDB connected!');
    return db;
  } catch (error) {
    console.error('MongoDB connection error:', error);
    throw error;
  }
}

// Middleware to ensure DB connection
const ensureDB = async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    res.status(500).send({ message: 'Database connection failed' });
  }
};

// Firebase Token Verification
const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' });
  }

  try {
    const idToken = token.split(' ')[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.decoded_email = decoded.email;
    next();
  } catch (err) {
    return res.status(401).send({ message: 'unauthorized access' });
  }
};

// ===================== ROUTES =====================

// Health check
app.get('/', (req, res) => {
  res.send('redHope is hoping!!');
});

// Health check with DB
app.get('/health', ensureDB, (req, res) => {
  res.send({ status: 'ok', message: 'Server and DB are running' });
});

/* -------------------------------- USERS -------------------------------- */

// Create user (Registration)
app.post('/users', ensureDB, async (req, res) => {
  try {
    const user = req.body;
    console.log('Creating user:', user.email);

    const exists = await usersCollection.findOne({ email: user.email });
    if (exists) {
      return res.send({ message: 'user exists', user: exists });
    }

    user.role = 'donor';
    user.status = 'active';
    user.createdAt = new Date();

    const result = await usersCollection.insertOne(user);
    console.log('User created:', result.insertedId);
    res.send(result);
  } catch (err) {
    console.error('Error creating user:', err);
    res.status(500).send({ message: 'Failed to save user', error: err.message });
  }
});

// Get all users
app.get('/users', ensureDB, async (req, res) => {
  try {
    const { status, role, bloodGroup, district, upazila } = req.query;
    const query = {};

    if (status) query.status = status;
    if (role) query.role = role;
    if (bloodGroup) query.bloodGroup = bloodGroup;
    if (district) query.district = district;
    if (upazila) query.upazila = upazila;

    const users = await usersCollection
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();

    res.send(users);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Failed to get users' });
  }
});

// Get user profile by email
app.get('/users/profile/:email', ensureDB, async (req, res) => {
  try {
    const email = req.params.email;
    const user = await usersCollection.findOne({ email });

    if (!user) {
      return res.status(404).send({ message: 'User not found' });
    }

    res.send(user);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Failed to get user profile' });
  }
});

// Update user profile
app.patch('/users/profile/:email', ensureDB, async (req, res) => {
  try {
    const email = req.params.email;
    const updated = req.body;
    delete updated.email;
    delete updated.role;
    delete updated.status;

    const result = await usersCollection.updateOne(
      { email },
      { $set: updated }
    );

    res.send(result);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Failed to update user profile' });
  }
});

// Get user role
app.get('/users/:email/role', ensureDB, async (req, res) => {
  try {
    const email = req.params.email;
    const user = await usersCollection.findOne({ email });
    res.send({ role: user?.role || 'donor' });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Failed to get user role' });
  }
});

// Update user status
app.patch('/users/:id/status', ensureDB, async (req, res) => {
  try {
    const id = req.params.id;
    const { status } = req.body;

    const result = await usersCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status } }
    );

    res.send(result);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Failed to update status' });
  }
});

// Update user role
app.patch('/users/:id/role', ensureDB, async (req, res) => {
  try {
    const id = req.params.id;
    const { role } = req.body;

    const result = await usersCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { role } }
    );

    res.send(result);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Failed to update role' });
  }
});

/* --------------------------- DASHBOARD STATS --------------------------- */

app.get('/dashboard-stats', ensureDB, async (req, res) => {
  try {
    const totalDonors = await usersCollection.countDocuments({ role: 'donor' });

    const fundingAgg = await fundingCollection
      .aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }])
      .toArray();
    const totalFunding = fundingAgg[0]?.total || 0;

    const totalDonationRequests = await DonationCollection.countDocuments();

    res.send({
      totalDonors,
      totalFunding,
      totalDonationRequests,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Failed to get dashboard stats' });
  }
});

/* ------------------------ DONATION REQUESTS API ------------------------ */

// Get donation requests (with optional auth)
app.get('/donation-requests', ensureDB, verifyFBToken, async (req, res) => {
  try {
    const { email, status, bloodGroup, district, upazila } = req.query;
    const query = {};

    if (email) query.requesterEmail = email;
    if (status) query.status = status;
    if (bloodGroup) query.bloodGroup = bloodGroup;
    if (district) query.recipientDistrict = district;
    if (upazila) query.recipientUpazila = upazila;

    const result = await DonationCollection
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();
      
    res.send(result);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Failed to get donation requests' });
  }
});

// Get single donation request
app.get('/donation-requests/:id', ensureDB, async (req, res) => {
  try {
    const id = req.params.id;
    const result = await DonationCollection.findOne({ _id: new ObjectId(id) });
    res.send(result);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Failed to get donation request' });
  }
});

// Create donation request
app.post('/donation-requests', ensureDB, async (req, res) => {
  try {
    const donation = req.body;
    donation.createdAt = new Date();
    donation.status = donation.status || 'pending';
    const result = await DonationCollection.insertOne(donation);
    res.send(result);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Failed to create donation request' });
  }
});

// Update donation request
app.patch('/donation-requests/:id', ensureDB, async (req, res) => {
  try {
    const id = req.params.id;
    const updatedData = req.body;
    
    const result = await DonationCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updatedData }
    );

    res.send(result);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Failed to update donation request' });
  }
});

// Delete donation request
app.delete('/donation-requests/:id', ensureDB, async (req, res) => {
  try {
    const id = req.params.id;
    const result = await DonationCollection.deleteOne({ _id: new ObjectId(id) });
    res.send(result);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Failed to delete donation request' });
  }
});

/* --------------------------- FUNDING (Stripe) --------------------------- */

app.get("/fundings", ensureDB, async (req, res) => {
  try {
    const result = await fundingCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();
    res.send(result);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Failed to get fundings" });
  }
});

app.post("/funding-checkout-session", ensureDB, async (req, res) => {
  try {
    const { amount, donorName, donorEmail } = req.body;

    const numericAmount = parseInt(amount, 10);
    if (!numericAmount || numericAmount <= 0) {
      return res.status(400).send({ message: "Invalid amount" });
    }

    const session = await stripe.checkout.sessions.create({
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: numericAmount * 100,
            product_data: {
              name: "Donation to RedHope",
            },
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      customer_email: donorEmail,
      metadata: {
        donorName,
        donorEmail,
        type: "funding",
      },
      success_url: `${process.env.SITE_DOMAIN}/funding?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.SITE_DOMAIN}/funding`,
    });

    res.send({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Failed to create checkout session" });
  }
});

app.get("/funding-success", ensureDB, async (req, res) => {
  try {
    const sessionId = req.query.session_id;
    if (!sessionId) {
      return res.status(400).send({ message: "Missing session_id" });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    const transactionId = session.payment_intent;
    const existing = await fundingCollection.findOne({ transactionId });
    if (existing) {
      return res.send({ message: "already exists", transactionId });
    }

    if (session.payment_status === "paid") {
      const fund = {
        donorName: session.metadata?.donorName || session.customer_email,
        donorEmail: session.customer_email,
        amount: session.amount_total / 100,
        currency: session.currency,
        transactionId: session.payment_intent,
        paymentStatus: session.payment_status,
        createdAt: new Date(),
      };

      const result = await fundingCollection.insertOne(fund);

      return res.send({
        success: true,
        fundId: result.insertedId,
        transactionId: session.payment_intent,
      });
    }

    res.send({ success: false, message: "Payment not completed" });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Failed to confirm funding" });
  }
});

// Start server (for local development)
if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}

// Export for Vercel
module.exports = app;