import { getRemindersCollection } from './db.js';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
export interface ReminderInput {
  chatId: number;
  message: string;
  fireAt: Date; // Absolute UTC moment to fire
}

// ─────────────────────────────────────────────
// Send Telegram message helper (standalone, no circular dep)
// ─────────────────────────────────────────────
async function sendTelegramReminder(chatId: number, message: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_API;
  if (!botToken) {
    console.warn('[Reminders] TELEGRAM_BOT_API not set — cannot send reminder');
    return;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `⏰ Recordatorio: ${message}`,
      }),
    });
    if (!res.ok) {
      console.error(`[Reminders] Failed to send Telegram message: ${await res.text()}`);
    } else {
      console.log(`[Reminders] ✅ Sent reminder to chatId ${chatId}: "${message}"`);
    }
  } catch (e) {
    console.error('[Reminders] Error sending Telegram reminder', e);
  }
}

// ─────────────────────────────────────────────
// Mark a reminder as sent in MongoDB
// ─────────────────────────────────────────────
async function markReminderSent(id: any): Promise<void> {
  try {
    const col = getRemindersCollection();
    await col.updateOne({ _id: id }, { $set: { status: 'sent', sentAt: new Date() } });
  } catch (e) {
    console.error('[Reminders] Failed to mark reminder as sent', e);
  }
}

// ─────────────────────────────────────────────
// Schedule a single reminder
// ─────────────────────────────────────────────
export async function scheduleReminder(reminder: ReminderInput): Promise<void> {
  const col = getRemindersCollection();

  // Persist to DB first
  const result = await col.insertOne({
    chatId: reminder.chatId,
    message: reminder.message,
    fireAt: reminder.fireAt,
    status: 'pending',
    createdAt: new Date(),
  });

  const docId = result.insertedId;
  const delayMs = reminder.fireAt.getTime() - Date.now();

  if (delayMs <= 0) {
    // Already past — fire immediately
    console.log(`[Reminders] fireAt is in the past, firing immediately for chatId ${reminder.chatId}`);
    await sendTelegramReminder(reminder.chatId, reminder.message);
    await markReminderSent(docId);
    return;
  }

  console.log(`[Reminders] Scheduled reminder for chatId ${reminder.chatId} in ${Math.round(delayMs / 1000)}s — "${reminder.message}"`);

  setTimeout(async () => {
    await sendTelegramReminder(reminder.chatId, reminder.message);
    await markReminderSent(docId);
  }, delayMs);
}

// ─────────────────────────────────────────────
// On server boot: restore pending reminders from MongoDB
// ─────────────────────────────────────────────
export async function restoreRemindersOnBoot(): Promise<void> {
  try {
    const col = getRemindersCollection();
    const pending = await col
      .find({ status: 'pending', fireAt: { $gt: new Date() } })
      .toArray();

    if (pending.length === 0) {
      console.log('[Reminders] No pending reminders to restore.');
      return;
    }

    console.log(`[Reminders] Restoring ${pending.length} pending reminder(s)...`);

    for (const doc of pending) {
      const delayMs = (doc.fireAt as Date).getTime() - Date.now();
      if (delayMs <= 0) {
        // Missed while server was down — fire now
        await sendTelegramReminder(doc.chatId as number, doc.message as string);
        await markReminderSent(doc._id);
      } else {
        console.log(`[Reminders] Re-scheduling reminder ${doc._id} in ${Math.round(delayMs / 1000)}s`);
        setTimeout(async () => {
          await sendTelegramReminder(doc.chatId as number, doc.message as string);
          await markReminderSent(doc._id);
        }, delayMs);
      }
    }
  } catch (e) {
    console.error('[Reminders] Failed to restore reminders on boot', e);
  }
}
