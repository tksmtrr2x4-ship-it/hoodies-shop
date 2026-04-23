const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const QRCode = require('qrcode');

async function createInvoiceAndSendEmail(order, pricePerItem, settings) {
    return new Promise(async (resolve, reject) => {
        const doc = new PDFDocument({ margin: 50 });
        let buffers =[];
        doc.on('data', buffers.push.bind(buffers));
        
        doc.on('end', async () => {
            let pdfData = Buffer.concat(buffers);
            let transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: process.env.SMTP_PORT,
                secure: false,
                auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            });

            let mailOptions = {
                from: process.env.SMTP_USER,
                to: order.email,
                subject: `Ihre Rechnung ${order.invoiceNumber}`,
                text: `Hallo ${order.name},\n\nvielen Dank für Ihre Bestellung! Im Anhang finden Sie Ihre Rechnung.\nBitte begleichen Sie den Betrag innerhalb von ${settings.payDays} Tagen.\n\nViele Grüße,\n${settings.issuerName}`,
                attachments:[{ filename: `${order.invoiceNumber}.pdf`, content: pdfData }]
            };

            try { await transporter.sendMail(mailOptions); resolve(); } 
            catch (e) { reject(e); }
        });

        // --- PDF LAYOUT ---
        const invoiceDate = new Date().toLocaleDateString('de-DE');

        // 1. Briefkopf / Absender klein
        doc.fontSize(8).fillColor('#666666');
        doc.text(`${settings.issuerName} • ${settings.issuerStreet} • ${settings.issuerCity}`, 50, 50);
        doc.moveTo(50, 60).lineTo(200, 60).lineWidth(0.5).stroke('#cccccc');

        // 2. Empfänger (ohne Adresse)
        doc.fontSize(11).fillColor('#000000');
        doc.text(order.name, 50, 80);
        doc.text(order.email, 50, 95);

        // 3. Rechnungsdaten-Block (Rechts)
        doc.fontSize(10);
        doc.text(`Rechnungsnummer:`, 350, 80);
        doc.text(order.invoiceNumber, 450, 80, { align: 'right' });
        doc.text(`Rechnungsdatum:`, 350, 95);
        doc.text(invoiceDate, 450, 95, { align: 'right' });

        // 4. Titel
        doc.fontSize(18).font('Helvetica-Bold');
        doc.text(`Rechnung`, 50, 150);
        doc.font('Helvetica').fontSize(10);

        // 5. Tabelle
        let startY = 190;
        doc.font('Helvetica-Bold');
        doc.text('Beschreibung', 50, startY);
        doc.text('Menge', 250, startY, { width: 50, align: 'right' });
        doc.text('Einzelpreis', 350, startY, { width: 80, align: 'right' });
        doc.text('Gesamt', 460, startY, { width: 80, align: 'right' });
        doc.moveTo(50, startY + 15).lineTo(540, startY + 15).lineWidth(1).stroke('#000000');

        doc.font('Helvetica');
        let currentY = startY + 25;
        for (const [size, qty] of Object.entries(order.items)) {
            if (qty > 0) {
                doc.text(`Limitierter Hoodie (Größe ${size})`, 50, currentY);
                doc.text(qty.toString(), 250, currentY, { width: 50, align: 'right' });
                doc.text(`${pricePerItem.toFixed(2).replace('.', ',')} €`, 350, currentY, { width: 80, align: 'right' });
                doc.text(`${(qty * pricePerItem).toFixed(2).replace('.', ',')} €`, 460, currentY, { width: 80, align: 'right' });
                doc.moveTo(50, currentY + 15).lineTo(540, currentY + 15).lineWidth(0.5).stroke('#eeeeee');
                currentY += 25;
            }
        }

        // 6. Summe
        currentY += 20;
        doc.font('Helvetica-Bold').fontSize(12);
        doc.text(`Rechnungsbetrag:`, 320, currentY);
        doc.text(`${order.totalPrice.toFixed(2).replace('.', ',')} €`, 460, currentY, { width: 80, align: 'right' });
        doc.moveTo(320, currentY - 5).lineTo(540, currentY - 5).lineWidth(1).stroke('#000000');

        // 7. Rechtliche Hinweise & Zahlung
        currentY += 40;
        doc.font('Helvetica').fontSize(10);
        let paymentText = `Bitte überweisen Sie den Betrag von ${order.totalPrice.toFixed(2).replace('.', ',')} € innerhalb von ${settings.payDays} Tagen.\n\n`;
        if (settings.issuerIban) paymentText += `Bankverbindung: ${settings.issuerIban}\n`;
        if (settings.issuerPayPal) paymentText += `PayPal E-Mail: ${settings.issuerPayPal}\n`;
        paymentText += `Verwendungszweck: ${order.invoiceNumber}\n\n`;
        paymentText += `Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.`;
        doc.text(paymentText, 50, currentY, { width: 300 });

        // 8. QR Codes Generieren & Einfügen (GiroCode & PayPal)
        let qrX = 380;
        if (settings.issuerIban) {
            const cleanIban = settings.issuerIban.replace(/\s+/g, '');
            const epcString = `BCD\n002\n1\nSCT\n\n${settings.issuerName.substring(0, 70)}\n${cleanIban}\nEUR${order.totalPrice.toFixed(2)}\n\n\n${order.invoiceNumber}\n`;
            const giroBuffer = await QRCode.toBuffer(epcString, { width: 80, margin: 1 });
            doc.image(giroBuffer, qrX, currentY - 5, { width: 60 });
            doc.fontSize(7).fillColor('#666666');
            doc.text("GiroCode", qrX, currentY + 60, { width: 60, align: 'center' });
            qrX += 80;
        }

        if (settings.issuerPayPal) {
            const paypalUrl = `https://www.paypal.com/cgi-bin/webscr?cmd=_xclick&business=${encodeURIComponent(settings.issuerPayPal)}&amount=${order.totalPrice.toFixed(2)}&currency_code=EUR&item_name=${encodeURIComponent("Rechnung " + order.invoiceNumber)}`;
            const ppBuffer = await QRCode.toBuffer(paypalUrl, { width: 80, margin: 1 });
            doc.image(ppBuffer, qrX, currentY - 5, { width: 60 });
            doc.fontSize(7).fillColor('#666666');
            doc.text("PayPal", qrX, currentY + 60, { width: 60, align: 'center' });
        }

        // 9. Footer
        doc.fontSize(8).fillColor('#999999');
        doc.text(`Steuernummer / USt-IdNr.: ${settings.issuerTaxId}`, 50, 750, { align: 'center' });

        doc.end();
    });
}
module.exports = { createInvoiceAndSendEmail };