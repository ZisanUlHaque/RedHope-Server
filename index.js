const express = require('express')
const cors = require('cors')
const app = express()
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 3000

//middleware
app.use(express.json());
app.use(cors());


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ifwcykr.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db('redHope_db');
    const DonationCollection = db.collection('donation-requests');

    //donation api
    app.get('/donation-requests',async(req,res)=>{
      const query = {}
      const {email} = req.query;

      if(email){
        query.requesterEmail = email;
      }

      const options = {sort: {createdAt: -1}}
      const cursor = DonationCollection.find(query,options);
      const result = await cursor.toArray();
      res.send(result);
    })

    // get single donation request by id
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
    const updatedData = req.body;        // ja ja field pathabe, segulai update hobe
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
    app.post('/donation-requests',async(req,res)=>{
        const donation = req.body;
        donation.createdAt = new Date();
        const result = await DonationCollection.insertOne(donation);
        res.send(result);
    })

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

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('redHope is hoping!!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
