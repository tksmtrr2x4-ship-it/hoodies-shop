const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');

async function createInvoiceAndSendEmail(order, pricePerItem) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument();
        let buffers =[];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', async () => {
            let pdfData = Buffer.concat(buffers);

            // E-Mail konfigurieren
            let transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: process.env.SMTP_PORT,
                secure: false, // true für 465, false für andere Ports
                auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            });

            let mailOptions = {
                from: process.env.SMTP_USER,
                to: order.email,
                subject: `Ihre Rechnung zur Bestellung ${order._id}`,
                text: `Hallo ${order.name},\n\nvielen Dank für Ihre Bestellung! Im Anhang finden Sie Ihre Rechnung.\nBitte begleichen Sie den Betrag innerhalb von 7 Tagen.\n\nViele Grüße,\nDein Hoodie-Team`,
                attachments: [{ filename: `Rechnung_${order._id}.pdf`, content: pdfData }]
            };

            try {
                await transporter.sendMail(mailOptions);
                resolve();
            } catch (e) {
                reject(e);
            }
        });

        // PDF Inhalt gestalten
        doc.fontSize(20).text('Rechnung', { align: 'center' }).moveDown();
        doc.fontSize(12).text(`Rechnungsnummer: ${order._id}`);
        doc.text(`Datum: ${new Date().toLocaleDateString('de-DE')}`);
        doc.moveDown().text(`Kunde:\n${order.name}\n${order.address}\n${order.email}`);
        
        doc.moveDown().text('Bestellte Artikel:', { underline: true });
        for (const [size, qty] of Object.entries(order.items)) {
            if (qty > 0) {
                doc.text(`${qty}x Hoodie (Größe ${size}) - je ${pricePerItem.toFixed(2)} € = ${(qty * pricePerItem).toFixed(2)} €`);
            }
        }
        
        doc.moveDown().fontSize(14).text(`Gesamtbetrag: ${order.totalPrice.toFixed(2)} €`, { bold: true });
        
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 7);
        doc.moveDown().fontSize(10).text(`Bitte überweisen Sie den Betrag bis zum ${dueDate.toLocaleDateString('de-DE')} auf folgendes Konto: DE12 3456 7890 1234 5678 90`);
        
        doc.end();
    });
}

module.exports = { createInvoiceAndSendEmail };