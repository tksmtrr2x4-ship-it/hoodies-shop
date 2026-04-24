const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const QRCode = require('qrcode');

async function createInvoiceAndSendEmail(order, pricePerItem, settings, isReminder = false) {
    return new Promise(async (resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 30, left: 50, right: 50 } });
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

            const subjectText = isReminder ? `Erinnerung: Deine offene Rechnung ${order.invoiceNumber}` : `Ihre Rechnung ${order.invoiceNumber}`;
            
            let mailBody = `Hallo ${order.name},\n\n`;
            if (isReminder) {
                mailBody += `Wir wollten dich kurz daran erinnern, dass die Zahlung für deine Bestellung noch aussteht. Im Anhang findest du deine Rechnung.\n\n`;
            } else {
                mailBody += `Vielen Dank für deine Bestellung! Im Anhang findest du deine Rechnung.\n\n`;
            }

            mailBody += `📱 SO KANNST DU BEZAHLEN:\n`;
            mailBody += `1. GiroCode (Banking App): Öffne deine Banking-App, wähle "QR-Code scannen" (oder Foto-Überweisung) und scanne den linken QR-Code auf der Rechnung. Alle Überweisungsdaten sind direkt ausgefüllt.\n\n`;
            mailBody += `2. PayPal: Scanne den rechten QR-Code mit deiner Smartphone-Kamera oder der PayPal-App.\n`;
            mailBody += `🚨 WICHTIGER HINWEIS ZU PAYPAL: Bitte wähle bei der Zahlung zwingend "Geld an Freunde und Familie senden" aus! Bei der Option "Waren und Dienstleistungen" zieht PayPal uns Transaktionsgebühren ab, wodurch dein Hoodie nicht vollständig bezahlt ist und nicht in den Druck gehen kann.\n\n`;
            mailBody += `Natürlich kannst du den Betrag auch klassisch mit den Daten auf der Rechnung überweisen.\n\n`;
            mailBody += `Viele Grüße,\n${settings.issuerName}`;

            let mailOptions = {
                from: process.env.SMTP_USER,
                to: order.email,
                subject: subjectText,
                text: mailBody,
                attachments:[{ filename: `${order.invoiceNumber}.pdf`, content: pdfData }]
            };

            try { await transporter.sendMail(mailOptions); resolve(); } 
            catch (e) { reject(e); }
        });

        // --- PDF LAYOUT ---
        const invoiceDate = new Date().toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' });

        doc.fontSize(8).fillColor('#666666');
        doc.text(`${settings.issuerName} • ${settings.issuerStreet} • ${settings.issuerCity}`, 50, 40);
        doc.moveTo(50, 50).lineTo(200, 50).lineWidth(0.5).stroke('#cccccc');
        doc.fontSize(11).fillColor('#000000');
        doc.text(order.name, 50, 70);
        doc.text(order.email, 50, 85);
        doc.fontSize(10);
        doc.text(`Rechnungsnummer:`, 350, 70);
        doc.text(order.invoiceNumber, 450, 70, { align: 'right' });
        doc.text(`Rechnungsdatum:`, 350, 85);
        doc.text(invoiceDate, 450, 85, { align: 'right' });
        doc.fontSize(18).font('Helvetica-Bold');
        doc.text(`Rechnung`, 50, 130);
        doc.font('Helvetica').fontSize(10);
        
        let startY = 160;
        doc.font('Helvetica-Bold');
        doc.text('Beschreibung', 50, startY);
        doc.text('Menge', 250, startY, { width: 50, align: 'right' });
        doc.text('Einzelpreis', 350, startY, { width: 80, align: 'right' });
        doc.text('Gesamt', 460, startY, { width: 80, align: 'right' });
        doc.moveTo(50, startY + 12).lineTo(540, startY + 12).lineWidth(1).stroke('#000000');
        doc.font('Helvetica');
        let currentY = startY + 20;
        
        for (const [size, qty] of Object.entries(order.items)) {
            if (qty > 0) {
                doc.text(`Abschlusshoodie STU 2026 (Gr. ${size})`, 50, currentY);
                doc.text(qty.toString(), 250, currentY, { width: 50, align: 'right' });
                doc.text(`${pricePerItem.toFixed(2).replace('.', ',')} €`, 350, currentY, { width: 80, align: 'right' });
                doc.text(`${(qty * pricePerItem).toFixed(2).replace('.', ',')} €`, 460, currentY, { width: 80, align: 'right' });
                doc.moveTo(50, currentY + 12).lineTo(540, currentY + 12).lineWidth(0.5).stroke('#eeeeee');
                currentY += 20; 
            }
        }
        
        currentY += 15;
        doc.font('Helvetica-Bold').fontSize(12);
        doc.text(`Rechnungsbetrag:`, 320, currentY);
        doc.text(`${order.totalPrice.toFixed(2).replace('.', ',')} €`, 460, currentY, { width: 80, align: 'right' });
        doc.moveTo(320, currentY - 5).lineTo(540, currentY - 5).lineWidth(1).stroke('#000000');
        
        currentY += 35;
        doc.font('Helvetica').fontSize(10);
        let paymentText = `Bitte überweise den Betrag von ${order.totalPrice.toFixed(2).replace('.', ',')} € innerhalb von ${settings.payDays} Tagen.\n\n`;
        if (settings.issuerIban) paymentText += `Bankverbindung: ${settings.issuerIban}\n`;
        if (settings.issuerPayPal) paymentText += `PayPal E-Mail: ${settings.issuerPayPal} (Bitte zwingend "Freunde" wählen!)\n`;
        paymentText += `Verwendungszweck: ${order.invoiceNumber}\n\n`;
        paymentText += `Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.`;
        doc.text(paymentText, 50, currentY, { width: 300 });

        let qrX = 380;
        if (settings.issuerIban) {
            const cleanIban = settings.issuerIban.replace(/\s+/g, '');
            const epcString = `BCD\n002\n1\nSCT\n\n${settings.issuerName.substring(0, 70)}\n${cleanIban}\nEUR${order.totalPrice.toFixed(2)}\n\n\n${order.invoiceNumber}\n`;
            const giroBuffer = await QRCode.toBuffer(epcString, { width: 70, margin: 1 });
            doc.image(giroBuffer, qrX, currentY - 5, { width: 60 });
            doc.fontSize(7).fillColor('#666666');
            doc.text("GiroCode", qrX, currentY + 60, { width: 60, align: 'center' });
            qrX += 80;
        }

        if (settings.issuerPayPal) {
            const paypalUrl = `https://www.paypal.com/cgi-bin/webscr?cmd=_xclick&business=${encodeURIComponent(settings.issuerPayPal)}&amount=${order.totalPrice.toFixed(2)}&currency_code=EUR&item_name=${encodeURIComponent("Rechnung " + order.invoiceNumber)}`;
            const ppBuffer = await QRCode.toBuffer(paypalUrl, { width: 70, margin: 1 });
            doc.image(ppBuffer, qrX, currentY - 5, { width: 60 });
            doc.fontSize(7).fillColor('#666666');
            doc.text("PayPal", qrX, currentY + 60, { width: 60, align: 'center' });
        }

        doc.fontSize(8).fillColor('#999999');
        doc.text(`Steuernummer / USt-IdNr.: ${settings.issuerTaxId}`, 50, 800, { align: 'center' });
        doc.end();
    });
}

async function sendPaymentConfirmationEmail(order, settings) {
    let transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        secure: false,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });

    const subjectText = `Zahlungseingang bestätigt: Deine Bestellung ${order.invoiceNumber}`;
    
    let mailBody = `Hallo ${order.name},\n\n`;
    mailBody += `wir haben hervorragende Neuigkeiten: Deine Zahlung in Höhe von ${order.totalPrice.toFixed(2).replace('.', ',')} € für die Rechnungsnummer ${order.invoiceNumber} ist erfolgreich bei uns eingegangen! 🎉\n\n`;
    mailBody += `Vielen Dank für die schnelle und reibungslose Überweisung. Deine Bestellung ist damit fest vermerkt und vollständig bezahlt.\n\n`;
    mailBody += `Sobald unser Verkaufszeitraum abgelaufen ist, geben wir alle bestellten Hoodies gesammelt in die Produktion. Wir melden uns rechtzeitig bei dir, sobald die Pullover zur Ausgabe bereitliegen.\n\n`;
    mailBody += `Viele Grüße,\n`;
    mailBody += `${settings.issuerName}`;

    let mailOptions = {
        from: process.env.SMTP_USER,
        to: order.email,
        subject: subjectText,
        text: mailBody
    };

    await transporter.sendMail(mailOptions);
}

// NEU: Funktion für Stornierungs-Mail
async function sendCancellationEmail(order, settings) {
    let transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        secure: false,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });

    const subjectText = `Stornierung deiner Bestellung ${order.invoiceNumber}`;
    
    let mailBody = `Hallo ${order.name},\n\n`;
    mailBody += `hiermit bestätigen wir dir die Stornierung deiner Bestellung mit der Rechnungsnummer ${order.invoiceNumber}.\n\n`;
    mailBody += `Deine Bestellung wurde in unserem System gelöscht.\n\n`;
    mailBody += `Solltest du diese Stornierung nicht selbst veranlasst haben oder Fragen dazu haben, wende dich bitte an unseren Support:\n`;
    if (settings.supportPhone && settings.supportPhone !== "") {
        mailBody += `📞 Telefon / WhatsApp: ${settings.supportPhone}\n`;
    }
    mailBody += `✉️ Oder antworte einfach direkt auf diese E-Mail.\n\n`;
    mailBody += `Viele Grüße,\n`;
    mailBody += `${settings.issuerName}`;

    let mailOptions = {
        from: process.env.SMTP_USER,
        to: order.email,
        subject: subjectText,
        text: mailBody
    };

    await transporter.sendMail(mailOptions);
}

// Alle 3 Funktionen exportieren
module.exports = { createInvoiceAndSendEmail, sendPaymentConfirmationEmail, sendCancellationEmail };