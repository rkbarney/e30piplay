// Faces cycled by the − button, and the choices offered on the Settings
// boot-screen picker. Single source of truth so DisplaySwitcher and
// SettingsScreen can't drift out of sync.
export const FACES = ['hal', 'factory', 'digital', 'system', 'games'];

export const DEFAULT_BOOT_SCREEN = 'factory';

export const FACE_LABELS = {
  hal: 'H.A.L.',
  factory: 'ANALOG CLOCK',
  digital: 'DIGITAL CLOCK',
  system: 'SYSTEM',
  games: 'GAMES',
};
