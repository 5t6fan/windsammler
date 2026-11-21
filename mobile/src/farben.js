// Farben wie in der Web-App (web/style.css), hell und dunkel
import { useColorScheme } from 'react-native';

const HELL = {
  bg: '#f3f5f4', flaeche: '#ffffff', text: '#17201d', leise: '#5d6b66', linie: '#dfe5e2',
  akzent: '#0e6b58', akzentHell: '#d9efe9', akzentText: '#ffffff', planung: '#8a8f99', gold: '#c58b12',
  goldHell: '#faf1df', goldMittel: '#f3e0b8',   // Hintergrund gesammelter bzw. berührter Anlagen in der Liste
  abgebaut: '#7b4fb0', abgebautHell: '#efe8f6', gewaehlt: '#e0452b', dunkel: false,
};
const DUNKEL = {
  bg: '#0f1412', flaeche: '#19201d', text: '#e8eeeb', leise: '#94a39d', linie: '#2a3430',
  akzent: '#3cc4a2', akzentHell: '#183a32', akzentText: '#06201a', planung: '#79808b', gold: '#e5b23a',
  goldHell: '#2b2618', goldMittel: '#3d331a',
  abgebaut: '#a783d6', abgebautHell: '#2a2235', gewaehlt: '#ff6a4d', dunkel: true,
};

export function useFarben() {
  return useColorScheme() === 'dark' ? DUNKEL : HELL;
}

// Punktfarben auf der Karte (feste Werte, auf Kartenhintergrund gut sichtbar)
export const PUNKT = { gewaehlt: '#e0452b', gesammelt: '#c58b12', aktiv: '#0e6b58', planung: '#8a8f99', abgebaut: '#7b4fb0' };
