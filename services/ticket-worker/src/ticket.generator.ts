import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

import type { FulfillmentPassenger, FulfillmentSnapshot, GeneratedTicket } from './ticket.types';

const regularFont = resolve(__dirname, '../assets/BeVietnamPro-Regular.ttf');
const boldFont = resolve(__dirname, '../assets/BeVietnamPro-Bold.ttf');

@Injectable()
export class TicketGenerator {
  async generate(snapshot: FulfillmentSnapshot, issuedAt: string): Promise<GeneratedTicket[]> {
    return Promise.all(
      snapshot.passengers.map((passenger) => this.generatePassenger(snapshot, passenger, issuedAt)),
    );
  }

  private async generatePassenger(
    snapshot: FulfillmentSnapshot,
    passenger: FulfillmentPassenger,
    issuedAt: string,
  ): Promise<GeneratedTicket> {
    const id = deterministicUuid(`${snapshot.bookingId}:${passenger.id}`);
    const ticketCode = `VT-${snapshot.bookingCode.replace(/^BV-/, '')}-${passenger.seatId}`;
    const qrPayload = `${snapshot.bookingCode}-${id}`;
    const qrPng = await QRCode.toBuffer(qrPayload, {
      type: 'png',
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 220,
    });
    const routeLabel = `${snapshot.trip.originName} -> ${snapshot.trip.destinationName}`;
    const vehicleLabel = [snapshot.trip.vehicleCode, snapshot.trip.vehiclePlate]
      .filter(Boolean)
      .join(' - ');
    const ticket: Omit<GeneratedTicket, 'htmlContent' | 'pdfDocument'> = {
      id,
      bookingId: snapshot.bookingId,
      passengerId: passenger.id,
      owner: snapshot.owner,
      ticketCode,
      bookingCode: snapshot.bookingCode,
      passengerName: passenger.fullName,
      seatId: passenger.seatId,
      routeLabel,
      pickupName: snapshot.trip.pickupName,
      dropoffName: snapshot.trip.dropoffName,
      departureAt: snapshot.trip.departureAt,
      vehicleLabel,
      qrPayload,
      issuedAt,
    };
    return {
      ...ticket,
      htmlContent: renderHtml(ticket, qrPng.toString('base64'), snapshot.trip.timezone),
      pdfDocument: await renderPdf(ticket, qrPng, snapshot.trip.timezone),
    };
  }
}

function renderHtml(
  ticket: Omit<GeneratedTicket, 'htmlContent' | 'pdfDocument'>,
  qrBase64: string,
  timezone: string,
): string {
  const departure = formatDeparture(ticket.departureAt, timezone);
  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Vé điện tử ${escapeHtml(ticket.ticketCode)}</title>
  <style>
    *{box-sizing:border-box}body{margin:0;background:#f3efe6;color:#17201c;font-family:"Be Vietnam Pro",sans-serif;padding:24px}
    .ticket{max-width:760px;margin:auto;background:#fffdf7;border:1px solid #d5c9b5;border-radius:28px;overflow:hidden;box-shadow:0 24px 70px rgba(43,54,45,.14)}
    header{padding:30px 34px;background:linear-gradient(135deg,#143d32,#276c55);color:white;display:flex;justify-content:space-between;gap:20px}
    header p{margin:0 0 8px;letter-spacing:.18em;text-transform:uppercase;font-size:12px}header h1{margin:0;font-size:30px}header strong{font-size:18px}
    main{display:grid;grid-template-columns:1fr 190px;gap:28px;padding:32px 34px}.route{font-size:25px;font-weight:700;margin:0 0 24px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
    dt{font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:#6a746e;margin-bottom:5px}dd{margin:0;font-weight:700}.qr{text-align:center;border-left:1px dashed #c8bcaa;padding-left:28px}.qr img{width:150px;height:150px}.qr small{display:block;overflow-wrap:anywhere;color:#59635e}
    footer{padding:18px 34px;background:#f0eadf;color:#536059;font-size:13px}@media(max-width:620px){main{grid-template-columns:1fr}.qr{border-left:0;border-top:1px dashed #c8bcaa;padding:24px 0 0}.grid{grid-template-columns:1fr}}
  </style>
</head>
<body><article class="ticket"><header><div><p>Bến Việt - Vé điện tử</p><h1>${escapeHtml(ticket.ticketCode)}</h1></div><strong>Ghế ${escapeHtml(ticket.seatId)}</strong></header>
<main><section><p class="route">${escapeHtml(ticket.routeLabel)}</p><dl class="grid">
<div><dt>Hành khách</dt><dd>${escapeHtml(ticket.passengerName)}</dd></div><div><dt>Mã booking</dt><dd>${escapeHtml(ticket.bookingCode)}</dd></div>
<div><dt>Khởi hành</dt><dd>${escapeHtml(departure)}</dd></div><div><dt>Xe</dt><dd>${escapeHtml(ticket.vehicleLabel)}</dd></div>
<div><dt>Điểm đón</dt><dd>${escapeHtml(ticket.pickupName)}</dd></div><div><dt>Điểm trả</dt><dd>${escapeHtml(ticket.dropoffName)}</dd></div>
</dl></section><aside class="qr"><img alt="QR vé mô phỏng" src="data:image/png;base64,${qrBase64}"><small>${escapeHtml(ticket.qrPayload)}</small></aside></main>
<footer>Vui lòng có mặt tại điểm đón trước giờ khởi hành ít nhất 30 phút và xuất trình mã vé khi check-in.</footer></article></body></html>`;
}

async function renderPdf(
  ticket: Omit<GeneratedTicket, 'htmlContent' | 'pdfDocument'>,
  qrPng: Buffer,
  timezone: string,
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A5',
    margin: 34,
    info: { Title: `Vé điện tử ${ticket.ticketCode}`, Author: 'Bến Việt Demo' },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const completed = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  doc.registerFont('BV-Regular', regularFont);
  doc.registerFont('BV-Bold', boldFont);
  doc.roundedRect(0, 0, doc.page.width, 126, 0).fill('#143d32');
  doc.fillColor('#ffffff').font('BV-Regular').fontSize(10).text('BẾN VIỆT - VÉ ĐIỆN TỬ', 34, 28, {
    characterSpacing: 1.2,
  });
  doc.font('BV-Bold').fontSize(22).text(ticket.ticketCode, 34, 51);
  doc.fontSize(15).text(`Ghế ${ticket.seatId}`, 34, 88);
  doc.fillColor('#17201c').font('BV-Bold').fontSize(17).text(ticket.routeLabel, 34, 150, {
    width: 350,
  });
  const fields: Array<[string, string]> = [
    ['Hành khách', ticket.passengerName],
    ['Mã booking', ticket.bookingCode],
    ['Khởi hành', formatDeparture(ticket.departureAt, timezone)],
    ['Xe', ticket.vehicleLabel],
    ['Điểm đón', ticket.pickupName],
    ['Điểm trả', ticket.dropoffName],
  ];
  let y = 202;
  for (const [label, value] of fields) {
    doc.fillColor('#69736e').font('BV-Regular').fontSize(8).text(label.toUpperCase(), 34, y);
    doc
      .fillColor('#17201c')
      .font('BV-Bold')
      .fontSize(10.5)
      .text(value, 34, y + 13, {
        width: 255,
      });
    y += 50;
  }
  doc.image(qrPng, 302, 214, { width: 105, height: 105 });
  doc.fillColor('#59635e').font('BV-Regular').fontSize(6.5).text(ticket.qrPayload, 302, 326, {
    width: 105,
    align: 'center',
  });
  doc.roundedRect(28, 493, doc.page.width - 56, 76, 12).fill('#f0eadf');
  doc
    .fillColor('#435149')
    .font('BV-Regular')
    .fontSize(8.5)
    .text(
      'Vui lòng có mặt tại điểm đón trước giờ khởi hành ít nhất 30 phút và xuất trình mã vé khi check-in.',
      42,
      515,
      { width: doc.page.width - 84, align: 'center' },
    );
  doc.end();
  return completed;
}

function deterministicUuid(value: string): string {
  const bytes = Buffer.from(createHash('sha256').update(value).digest().subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function formatDeparture(value: string, timezone: string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: timezone,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    };
    return entities[character] ?? character;
  });
}
