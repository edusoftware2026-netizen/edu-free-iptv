/* Logica central de Control Parental y proteccion de contenido adulto.
   Soporta auto-deteccion heuristica, flags Xtream, bloqueo manual de categorias,
   modos 'hide' (invisibilidad total) y 'lock' (candado con PIN), y timeout de sesion.
*/

import { store } from './store.js';

export const ADULT_REGEX = /(^|[\s_.\-[\](+])(xxx|adult|adulto|adultos|18\+|porn|porno|erotic|erotica|erotico|playboy|venus|hustler|brazzers|redlight|penthouse|for adults|mature|sensual|for adult|hot|sexo|x-rated)([\s_.\-[\])+]|$)/i;

let sessionUnlockedUntil = 0;

export function isSessionUnlocked() {
  return Date.now() < sessionUnlockedUntil;
}

export function unlockSession(minutes = 15) {
  const m = Number(minutes);
  if (m <= 0) {
    sessionUnlockedUntil = 0;
  } else {
    sessionUnlockedUntil = Date.now() + (m * 60 * 1000);
  }
}

export function lockSession() {
  sessionUnlockedUntil = 0;
}

export function isParentalEnabled() {
  return !!store.state.settings.parental?.enabled;
}

export function getParentalMode() {
  return store.state.settings.parental?.mode || 'hide';
}

export function isAdultString(str) {
  if (!str || typeof str !== 'string') return false;
  return ADULT_REGEX.test(str.trim());
}

export function isAdultItem(item) {
  if (!item) return false;
  if (item.is_adult === 1 || item.is_adult === '1') return true;
  if (isAdultString(item.name)) return true;
  if (isAdultString(item.group)) return true;
  if (isAdultString(item.categoryName)) return true;
  return false;
}

export function isCategoryLocked(cat) {
  if (!isParentalEnabled()) return false;
  if (!cat) return false;
  const strId = String(cat.id || '');
  const lockedList = store.state.settings.parental?.customLockedCats || [];
  if (lockedList.includes(strId)) return true;
  if (isAdultString(cat.name) || isAdultString(cat.id)) return true;
  return false;
}

export function isItemLocked(item) {
  if (!isParentalEnabled()) return false;
  if (!item) return false;
  const strCatId = String(item.categoryId || '');
  const lockedList = store.state.settings.parental?.customLockedCats || [];
  if (lockedList.includes(strCatId)) return true;
  if (isAdultItem(item)) return true;
  return false;
}

export function shouldHideCategory(cat) {
  if (!isParentalEnabled()) return false;
  if (isSessionUnlocked()) return false;
  if (getParentalMode() !== 'hide') return false;
  return isCategoryLocked(cat);
}

export function shouldHideItem(item) {
  if (!isParentalEnabled()) return false;
  if (isSessionUnlocked()) return false;
  if (getParentalMode() !== 'hide') return false;
  return isItemLocked(item);
}

export function verifyPin(enteredPin) {
  const currentPin = store.state.settings.parental?.pin || '0000';
  return String(enteredPin).trim() === String(currentPin).trim();
}

export default {
  ADULT_REGEX,
  isSessionUnlocked,
  unlockSession,
  lockSession,
  isParentalEnabled,
  getParentalMode,
  isAdultString,
  isAdultItem,
  isCategoryLocked,
  isItemLocked,
  shouldHideCategory,
  shouldHideItem,
  verifyPin,
};
