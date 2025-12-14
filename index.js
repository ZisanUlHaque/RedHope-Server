// server.js (blood-donation backend)

const express = require('express');
const cors = require('cors');
const app = express();
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 3000;

// middleware
app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ifwcykr.mongodb.net/?appName=Cluster0`;

const stripe = require('stripe')(process.env.STRIPE_SECRET);

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const db = client.db('redHope_db');
    const DonationCollection = db.collection('donation-requests');
    const usersCollection = db.collection('users');
    const fundingCollection = db.collection('fundings');

    /* -------------------------------- USERS -------------------------------- */

    // registration এর পরে client থেকে POST /users
    app.post('/users', async (req, res) => {
      try {
        const user = req.body; // { name, email, avatar, bloodGroup, district, upazila }

        const exists = await usersCollection.findOne({ email: user.email });
        if (exists) {
          return res.send({ message: 'user exists' });
        }

        user.role = 'donor';      // default role
        user.status = 'active';   // default status
        user.createdAt = new Date();

        const result = await usersCollection.insertOne(user);
        res.send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: 'Failed to save user' });
      }
    });

    // All users list (admin panel, search page) + optional filters
    app.get('/users', async (req, res) => {
      try {
        const { status, role, bloodGroup, district, upazila } = req.query;
        const query = {};

        if (status) {
          query.status = status; // active | blocked
        }
        if (role) {
          query.role = role; // donor | admin | volunteer
        }
        if (bloodGroup) {
          query.bloodGroup = bloodGroup;
        }
        if (district) {
          query.district = district;
        }
        if (upazila) {
          query.upazila = upazila;
        }

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

    // full profile by email
    app.get('/users/profile/:email', async (req, res) => {
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

    // Update profile (except email/role/status)
    app.patch('/users/profile/:email', async (req, res) => {
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

    // role read
    app.get('/users/:email/role', async (req, res) => {
      try {
        const email = req.params.email;
        const user = await usersCollection.findOne({ email });
        res.send({ role: user?.role || 'donor' });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: 'Failed to get user role' });
      }
    });

    // status update (active / blocked)
    app.patch('/users/:id/status', async (req, res) => {
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

    // role update (donor / volunteer / admin)
    app.patch('/users/:id/role', async (req, res) => {
      try {
        const id = req.params.id;
        const { role } = req.body; // 'donor' | 'volunteer' | 'admin'

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

    app.get('/dashboard-stats', async (req, res) => {
      try {
        const totalDonors = await usersCollection.countDocuments({
          role: 'donor',
        });

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

    // list + filter (donor / admin / volunteer / search)
    app.get('/donation-requests', async (req, res) => {
      try {
        const { email, status, bloodGroup, district, upazila } = req.query;
        const query = {};

        // donor dashboard -> own requests
        if (email) {
          query.requesterEmail = email;
        }

        // admin/volunteer/public filter by status
        if (status) {
          query.status = status; // pending | inprogress | done | canceled
        }

        // search filters (optional)
        if (bloodGroup) query.bloodGroup = bloodGroup;
        if (district) query.recipientDistrict = district;
        if (upazila) query.recipientUpazila = upazila;

        const options = { sort: { createdAt: -1 } };

        const cursor = DonationCollection.find(query, options);
        const result = await cursor.toArray();
        res.send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: 'Failed to get donation requests' });
      }
    });

    // single donation request
    app.get('/donation-requests/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await DonationCollection.findOne(query);
        res.send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: 'Failed to get donation request' });
      }
    });

    // update donation request
    app.patch('/donation-requests/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const updatedData = req.body;
        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: updatedData,
        };

        const result = await DonationCollection.updateOne(filter, updateDoc);
        res.send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: 'Failed to update donation request' });
      }
    });

    // delete donation request
    app.delete('/donation-requests/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await DonationCollection.deleteOne(query);
        res.send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: 'Failed to delete donation request' });
      }
    });

    // create donation request
    app.post('/donation-requests', async (req, res) => {
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

    /* --------------------------- FUNDING (Stripe) --------------------------- */

    // সব funding list
    app.get("/fundings", async (req, res) => {
      try {
        const cursor = fundingCollection
          .find({})
          .sort({ createdAt: -1 });
        const result = await cursor.toArray();
        res.send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to get fundings" });
      }
    });

    // create checkout session for funding
    app.post("/funding-checkout-session", async (req, res) => {
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
                unit_amount: numericAmount * 100, // dollar -> cent
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

    // payment success confirm
    app.get("/funding-success", async (req, res) => {
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
        res.status(500).send({ message: "Failed to confirm funding", error: err.message });
      }
    });

    /* ---------------------------------------------------------------------- */

    await client.db('admin').command({ ping: 1 });
    console.log('MongoDB connected!');
  } finally {
    // client.close() debounce korar jonno empty rakha
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('redHope is hoping!!');
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});