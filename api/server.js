const express = require('express');
const mongoose = require('mongoose');
const basicAuth = require('express-basic-auth');
const { Parser } = require('json2csv');
const { createInvoiceAndSendEmail } = require('./utils');

const app = express();
app.use(express.json());

let isConnected;
const connectDB = async () => {
    if (isConnected) return;
    const db = await mongoose.connect(process.env.MONGODB_URI);
    isConnected = db.connections[0].readyState;
};

// --- SCHEMA ---
const OrderSchema = new mongoose.Schema({
    invoiceNumber: String,
    name: String, 
    email: String,
    role: String, 
    items: Object, 
    totalPrice: Number, 
    ipAddress: String,
    status: { type: String, default: 'offen' },
    createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', OrderSchema);

const SettingsSchema = new mongoose.Schema({
    issuerName: { type: String, default: "Dein Name" },
    issuerStreet: { type: String, default: "Musterstraße 1" },
    issuerCity: { type: String, default: "12345 Musterstadt" },
    issuerEmail: { type: String, default: "info@beispiel.de" },
    issuerTaxId: { type: String, default: "none" },
    issuerIban: { type: String, default: "" },
    issuerPayPal: { type: String, default: "" },
    payDays: { type: Number, default: 14 },
    supportPhone: { type: String, default: "" } // NEU: Telefonnummer
});
const Settings = mongoose.model('Settings', SettingsSchema);

// --- ÖFFENTLICHE API (Für die Anzeige der Telefonnummer) ---
app.get('/api/public-settings', async (req, res) => {
    try {
        await connectDB();
        let settings = await Settings.findOne();
        res.json({ supportPhone: settings ? settings.supportPhone : "" });
    } catch (e) {
        res.json({ supportPhone: "" });
    }
});

// --- KUNDEN API ---
app.post('/api/order', async (req, res) => {
    try {
        await connectDB();
        const { name, email, role, items, honeypot, dsgvo } = req.body;

        if (honeypot) return res.status(400).send('Spam erkannt.');
        if (!dsgvo) return res.status(400).send('DSGVO muss akzeptiert werden.');

        const pricePerItem = (role === 'Lehrer') ? 25.00 : 55.00;

        let totalQty = 0;
        for (let size in items) totalQty += items[size];
        if (totalQty === 0) return res.status(400).send('Keine Artikel ausgewählt.');

        const totalPrice = totalQty * pricePerItem;
        const ipAddress = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'Unbekannt';

        const orderCount = await Order.countDocuments();
        const year = new Date().getFullYear();
        const invoiceNum = `RE-${year}-${String(orderCount + 1).padStart(3, '0')}`;

        const newOrder = new Order({ invoiceNumber: invoiceNum, name, email, role, items, totalPrice, ipAddress });
        await newOrder.save();

        let settings = await Settings.findOne();
        if (!settings) settings = await Settings.create({}); 

        await createInvoiceAndSendEmail(newOrder, pricePerItem, settings);
        res.status(200).json({ message: 'Bestellung erfolgreich', orderId: newOrder._id });
    } catch (err) {
        console.error(err);
        res.status(500).send('Serverfehler bei der Bestellung.');
    }
});

// --- ADMIN API ---
const adminAuth = basicAuth({
    users: {[process.env.ADMIN_USER]: process.env.ADMIN_PASS },
    challenge: false 
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

// NEU: Bestellung löschen
app.delete('/api/admin/orders/:id', adminAuth, async (req, res) => {
    await connectDB();
    await Order.findByIdAndDelete(req.params.id);
    res.sendStatus(200);
});

app.get('/api/admin/settings', adminAuth, async (req, res) => {
    await connectDB();
    let settings = await Settings.findOne();
    if (!settings) settings = await Settings.create({});
    res.json(settings);
});

app.post('/api/admin/settings', adminAuth, async (req, res) => {
    await connectDB();
    await Settings.findOneAndUpdate({}, req.body, { upsert: true });
    res.sendStatus(200);
});

app.get('/api/admin/export', adminAuth, async (req, res) => {
    await connectDB();
    const orders = await Order.find().lean();
    const fields =['invoiceNumber', 'name', 'role', 'email', 'totalPrice', 'status', 'ipAddress', 'createdAt'];
    const json2csvParser = new Parser({ fields });
    res.header('Content-Type', 'text/csv');
    res.attachment('bestellungen.csv');
    res.send(json2csvParser.parse(orders));
});

module.exports = app;