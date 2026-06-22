import { Image, Linking, Pressable } from "react-native";
import { Button, Card, Row, Stack, Text } from "@preztiaos/ui";

type Location = {
  latitude: number;
  longitude: number;
  sharedAt: string;
};

/**
 * Tarjeta de UBICACIÓN del cliente compartida por WhatsApp (verificación geográfica). Muestra un
 * preview con MARCADOR (mapa estático de OpenStreetMap, sin API key) y, al tocarlo o con el botón,
 * abre el mapa interactivo (Google Maps con el pin) vía `Linking` — funciona en web y nativo, sin
 * dependencias de mapas. Si el preview no carga, las coordenadas y el botón siguen disponibles.
 */
export function LocationCard({ location }: { location: Location }) {
  const { latitude, longitude } = location;
  const coords = `${latitude},${longitude}`;
  // Mapa interactivo con marcador (abre app de mapas en nativo / pestaña nueva en web).
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${coords}`;
  // Preview estático con pin (sin credencial); degrada con gracia si el servicio no responde.
  const previewUrl = `https://staticmap.openstreetmap.de/staticmap.php?center=${coords}&zoom=16&size=600x300&markers=${coords},red-pushpin`;
  const openMap = () => void Linking.openURL(mapsUrl);

  return (
    <Card>
      <Stack gap="sm">
        <Text variant="heading">Ubicación del cliente</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Abrir la ubicación en el mapa"
          onPress={openMap}
        >
          <Image
            source={{ uri: previewUrl }}
            resizeMode="cover"
            className="h-[200px] w-full rounded-xl bg-zinc-100 dark:bg-zinc-800"
          />
        </Pressable>
        <Row className="justify-between">
          <Text variant="caption" tone="muted">
            {latitude.toFixed(5)}, {longitude.toFixed(5)}
          </Text>
          <Text variant="caption" tone="muted">
            Compartida: {new Date(location.sharedAt).toLocaleDateString()}
          </Text>
        </Row>
        <Button label="Ver en el mapa" variant="secondary" block onPress={openMap} />
      </Stack>
    </Card>
  );
}
