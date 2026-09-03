const db = require('../database/db');

function addSubscriber(chatId, name = '') {
  db.addSubscriber(chatId, name);
}

function removeSubscriber(chatId) {
  db.removeSubscriber(chatId);
}

function isSubscriber(chatId) {
  const sub = db.findSubscriber(chatId);
  return !!sub && sub.is_active === 1;
}

function getAllSubscribers() {
  return db.getActiveSubscribers();
}

function getSubscriberCount() {
  return db.getSubscriberCount();
}

module.exports = { addSubscriber, removeSubscriber, isSubscriber, getAllSubscribers, getSubscriberCount };