/**
 * Geolocalización SIN dependencias nuevas: usa `navigator.geolocation` del entorno (disponible
 * en web y React Native Web). En nativo (iOS/Android) no existe sin `expo-location`; en ese caso
 * `geolocationAvailable()` devuelve false y la UI ofrece el registro solo donde funciona.
 *
 * Cuando se autorice `expo-location`, basta reemplazar esta implementación sin tocar la UI.
 */
type GeoNavigator = {
  geolocation?: {
    getCurrentPosition: (
      success: (position: { coords: { latitude: number; longitude: number } }) => void,
      error: (err: unknown) => void,
      options?: { enableHighAccuracy?: boolean; timeout?: number },
    ) => void;
  };
};

function nav(): GeoNavigator["geolocation"] | undefined {
  return (globalThis as unknown as { navigator?: GeoNavigator }).navigator?.geolocation;
}

export function geolocationAvailable(): boolean {
  return typeof nav()?.getCurrentPosition === "function";
}

export function getCurrentPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    const geolocation = nav();
    if (!geolocation) {
      reject(new Error("Geolocalización no disponible en este dispositivo"));
      return;
    }
    geolocation.getCurrentPosition(
      (position) =>
        resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
}
