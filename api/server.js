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
    supportPhone: { type: String, default: "" },
    shopStatus: { type: String, default: "geöffnet" } // NEU: Ampel-Status
});
const Settings = mongoose.model('Settings', SettingsSchema);

// --- ÖFFENTLICHE API (Ampel & Telefonnummer) ---
app.get('/api/public-settings', async (req, res) => {
    try {
        await connectDB();
        let settings = await Settings.findOne();
        res.json({ 
            supportPhone: settings ? settings.supportPhone : "",
            shopStatus: settings ? settings.shopStatus : "geöffnet"
        });
    } catch (e) {
        res.json({ supportPhone: "", shopStatus: "geöffnet" });
    }
});

// --- KUNDEN API ---
app.post('/api/order', async (req, res) => {
    try {
        await connectDB();
        
        // Sicherheits-Check: Ist der Shop überhaupt offen?
        let settings = await Settings.findOne();
        if (!settings) settings = await Settings.create({}); 
        if (settings.shopStatus !== 'geöffnet') {
            return res.status(403).send('Der Verkauf ist aktuell nicht geöffnet.');
        }

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

        await createInvoiceAndSendEmail(newOrder, pricePerItem, settings);
        
        // NEU: invoiceNumber wird an das Frontend für den Success-Screen zurückgegeben
        res.status(200).json({ message: 'Bestellung erfolgreich', orderId: newOrder._id, invoiceNumber: invoiceNum });
    } catch (err) {
        console.error(err);
        res.status(500).send('Serverfehler bei der Bestellung.');
    }
});

// --- ADMIN API ---
const adminAuth = basicAuth({ users: {[process.env.ADMIN_USER]: process.env.ADMIN_PASS }, challenge: false });

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

// NEU: CSV Export teilt jede Größe in eine eigene Zeile auf!
app.get('/api/admin/export', adminAuth, async (req, res) => {
    await connectDB();
    const orders = await Order.find().lean();
    let flattenedOrders =[];

    orders.forEach(o => {
        const singlePrice = (o.role === 'Lehrer') ? 25 : 55;
        // Jeden Hoodie einzeln iterieren
        for (const [size, qty] of Object.entries(o.items)) {
            for (let i = 0; i < qty; i++) {
                flattenedOrders.push({
                    invoiceNumber: o.invoiceNumber,
                    name: o.name,
                    role: o.role,
                    email: o.email,
                    size: size,
                    price: singlePrice,
                    status: o.status,
                    createdAt: new Date(o.createdAt).toLocaleDateString('de-DE')
                });
            }
        }
    });

    const fields =['invoiceNumber', 'name', 'role', 'email', 'size', 'price', 'status', 'createdAt'];
    const json2csvParser = new Parser({ fields });
    res.header('Content-Type', 'text/csv');
    res.attachment('hoodie_bestellliste.csv');
    res.send(json2csvParser.parse(flattenedOrders));
});

module.exports = app;