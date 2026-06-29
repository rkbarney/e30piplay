// Faces cycled by the − button, and the choices offered on the Settings
// boot-screen picker. Single source of truth so DisplaySwitcher and
// SettingsScreen can't drift out of sync.
export const FACES = ['hal', 'spotify', 'factory', 'digital', 'games', 'system'];

export const DEFAULT_BOOT_SCREEN = 'factory';

export const FACE_LABELS = {
  hal: 'H.A.L.',
  spotify: 'SPOTIFY',
  factory: 'ANALOG CLOCK',
  digital: 'DIGITAL CLOCK',
  system: 'SYSTEM',
  games: 'GAMES',
};
