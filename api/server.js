const express = require('express');
const mongoose = require('mongoose');
const basicAuth = require('express-basic-auth');
const { Parser } = require('json2csv');
const { createInvoiceAndSendEmail } = require('./utils');

const app = express();
app.use(express.json());

// Serverless MongoDB Verbindung (verhindert ständige Neuverbindungen)
let isConnected;
const connectDB = async () => {
    if (isConnected) return;
    const db = await mongoose.connect(process.env.MONGODB_URI);
    isConnected = db.connections[0].readyState;
};

// Datenbank-Schema
const OrderSchema = new mongoose.Schema({
    name: String, address: String, email: String,
    items: Object, totalPrice: Number, ipAddress: String,
    status: { type: String, default: 'offen' },
    createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', OrderSchema);

// --- KUNDEN API ---
app.post('/api/order', async (req, res) => {
    try {
        await connectDB();
        const { name, address, email, items, honeypot, dsgvo } = req.body;

        if (honeypot) return res.status(400).send('Spam erkannt.');
        if (!dsgvo) return res.status(400).send('DSGVO muss akzeptiert werden.');

        const pricePerItem = parseFloat(process.env.HOODIE_PRICE);
        let totalQty = 0;
        for (let size in items) totalQty += items[size];
        if (totalQty === 0) return res.status(400).send('Keine Artikel ausgewählt.');

        const totalPrice = totalQty * pricePerItem;
        const ipAddress = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'Unbekannt';

        const newOrder = new Order({ name, address, email, items, totalPrice, ipAddress });
        await newOrder.save();

        await createInvoiceAndSendEmail(newOrder, pricePerItem);
        res.status(200).json({ message: 'Bestellung erfolgreich', orderId: newOrder._id });
    } catch (err) {
        console.error(err);
        res.status(500).send('Serverfehler bei der Bestellung.');
    }
});

// --- ADMIN API ---
const adminAuth = basicAuth({
    users: { [process.env.ADMIN_USER]: process.env.ADMIN_PASS },
    challenge: false // Kein Browser-Popup, wir machen das sauber im Frontend
});

app.get('/api/admin/orders', adminAuth, async (req, res) => {
    await connectDB();
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json(orders);
});

app.post('/api/admin/orders/:id/pay', adminAuth, async (req, res) => {
    await connectDB();
    await Order.findByIdAndUpdate(req.params.id, { status: 'bezahlt' });
    res.sendStatus(200);
});

app.get('/api/admin/export', adminAuth, async (req, res) => {
    await connectDB();
    const orders = await Order.find().lean();
    const fields =['_id', 'name', 'email', 'address', 'totalPrice', 'status', 'ipAddress', 'createdAt'];
    const json2csvParser = new Parser({ fields });
    res.header('Content-Type', 'text/csv');
    res.attachment('bestellungen.csv');
    res.send(json2csvParser.parse(orders));
});

// WICHTIG FÜR VERCEL: App exportieren statt app.listen()
module.exports = app;