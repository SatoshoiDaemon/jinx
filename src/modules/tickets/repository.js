import { DEFAULT_TICKET_SETTINGS } from '../../config/defaults.js';
import { getModuleConfig } from '../../models/bot-config.js';

export const TICKET_PANEL_COLLECTION = 'ticket_panels';
export const TICKET_COLLECTION = 'tickets';
export const TICKET_REQUEST_COLLECTION = 'ticket_requests';
export const TICKET_EVENT_COLLECTION = 'ticket_events';
export const TICKET_COUNTER_COLLECTION = 'ticket_counters';
export const TICKET_MEMBER_LIMIT_COLLECTION = 'ticket_member_limits';

export async function initializeTicketRepository(database) {
  await database.collection(TICKET_PANEL_COLLECTION).createIndex(
    { messageId: 1 },
    {
      name: 'ticket_panel_message',
      unique: true,
      partialFilterExpression: { messageId: { $type: 'string' } },
    },
  );
  await database.collection(TICKET_COLLECTION).createIndex(
    { threadId: 1 },
    {
      name: 'ticket_thread',
      unique: true,
      partialFilterExpression: { threadId: { $type: 'string' } },
    },
  );
  await database.collection(TICKET_COLLECTION).createIndex(
    { status: 1, 'finalization.state': 1 },
    { name: 'ticket_recovery' },
  );
  await database.collection(TICKET_COLLECTION).createIndex(
    { setupState: 1, createdAt: 1 },
    { name: 'ticket_setup_recovery' },
  );
  await database.collection(TICKET_COLLECTION).createIndex(
    { status: 1, setupState: 1, threadDeletedAt: 1 },
    { name: 'ticket_active_controls' },
  );
  await database.collection(TICKET_REQUEST_COLLECTION).createIndex(
    { expiresAt: 1 },
    { name: 'ticket_request_expiry', expireAfterSeconds: 0 },
  );
  await database.collection(TICKET_EVENT_COLLECTION).createIndex(
    { ticketId: 1, createdAt: 1 },
    { name: 'ticket_event_history' },
  );
  await database.collection(TICKET_EVENT_COLLECTION).createIndex(
    { logState: 1, createdAt: 1 },
    { name: 'ticket_event_retry' },
  );
  await database.collection(TICKET_COUNTER_COLLECTION).updateOne(
    { _id: 'ticket-number' },
    { $setOnInsert: { value: 0 } },
    { upsert: true },
  );
}

export function getTicketSettings(database) {
  return getModuleConfig(database, 'tickets', DEFAULT_TICKET_SETTINGS);
}

export async function allocateTicketNumber(database) {
  const counters = database.collection(TICKET_COUNTER_COLLECTION);
  const counter = await counters.findOneAndUpdate(
    { _id: 'ticket-number' },
    { $inc: { value: 1 } },
    { upsert: true, returnDocument: 'after' },
  );
  return counter.value;
}

export async function reserveMemberTicketSlot(database, userId, ticketId, optionId, limit, now = new Date()) {
  const limits = database.collection(TICKET_MEMBER_LIMIT_COLLECTION);
  try {
    await limits.updateOne(
      { _id: userId },
      { $setOnInsert: { tickets: [] } },
      { upsert: true },
    );
  } catch (error) {
    // Two first-time requests can race on the _id upsert; the winner created the row.
    if (error?.code !== 11000) throw error;
  }
  const result = await limits.updateOne(
    {
      _id: userId,
      $expr: {
        $lt: [
          {
            $size: {
              $filter: {
                input: { $ifNull: ['$tickets', []] },
                as: 'ticket',
                cond: { $eq: ['$$ticket.optionId', optionId] },
              },
            },
          },
          limit,
        ],
      },
    },
    {
      $addToSet: { tickets: { ticketId: String(ticketId), optionId: String(optionId) } },
      $set: { updatedAt: now },
    },
  );
  return result.modifiedCount === 1;
}

export async function releaseMemberTicketSlot(database, userId, ticketId, now = new Date()) {
  await database.collection(TICKET_MEMBER_LIMIT_COLLECTION).updateOne(
    { _id: userId },
    { $pull: { tickets: { ticketId: String(ticketId) } }, $set: { updatedAt: now } },
  );
}

export async function getMemberActiveTicketCount(database, userId, optionId) {
  const limits = await database.collection(TICKET_MEMBER_LIMIT_COLLECTION).findOne(
    { _id: userId },
    { projection: { tickets: 1 } },
  );
  return limits?.tickets?.filter((ticket) => ticket.optionId === optionId).length ?? 0;
}

export async function reconcileMemberTicketSlots(database) {
  const tickets = await database.collection(TICKET_COLLECTION)
    .find({
      status: { $in: ['open', 'closed'] },
      slotReleased: { $ne: true },
    }, { projection: { _id: 1, ownerId: 1, optionId: 1 } })
    .toArray();
  const expected = new Map();
  for (const ticket of tickets) {
    if (typeof ticket.ownerId !== 'string') {
      continue;
    }
    const activeTickets = expected.get(ticket.ownerId) ?? [];
    activeTickets.push({ ticketId: String(ticket._id), optionId: String(ticket.optionId) });
    expected.set(ticket.ownerId, activeTickets);
  }

  const limits = database.collection(TICKET_MEMBER_LIMIT_COLLECTION);
  const current = await limits.find({}, { projection: { _id: 1 } }).toArray();
  const currentIds = new Set(current.map((item) => item._id));
  for (const memberLimit of current) {
    await limits.updateOne(
      { _id: memberLimit._id },
      { $set: { tickets: expected.get(memberLimit._id) ?? [], updatedAt: new Date() } },
      { $unset: { ticketIds: '' } },
    );
  }
  for (const [userId, activeTickets] of expected) {
    if (currentIds.has(userId)) {
      continue;
    }
    await limits.updateOne(
      { _id: userId },
      { $set: { tickets: activeTickets, updatedAt: new Date() } },
      { upsert: true },
    );
  }
}
