import { Linking } from "react-native";
import { Button, Card, Row, Stack, Text } from "@preztiaos/ui";

import { CollectionMap } from "../../collections/components/collection-map";

type Location = {
  latitude: number;
  longitude: number;
  sharedAt: string;
};

/**
 * Tarjeta de UBICACIÓN del cliente compartida por WhatsApp (verificación geográfica). Pinta un mapa
 * interactivo con MARCADOR reutilizando `CollectionMap` (MapLibre + tiles OpenFreeMap, FOSS sin API
 * key; mismo componente que el mapa de cobro, con split web/nativo). El botón "Ver en el mapa" abre
 * el mapa externo (Google Maps con el pin) vía `Linking`, útil para navegar hasta el punto.
 */
export function LocationCard({ location }: { location: Location }) {
  const { latitude, longitude } = location;
  const coords = `${latitude},${longitude}`;
  // Mapa externo con marcador (abre app de mapas en nativo / pestaña nueva en web).
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${coords}`;
  const openMap = () => void Linking.openURL(mapsUrl);

  return (
    <Card>
      <Stack gap="sm">
        <Text variant="heading">Ubicación del cliente</Text>
        <CollectionMap
          center={{ latitude, longitude }}
          markers={[
            {
              id: "client-location",
              label: "Ubicación del cliente",
              kind: "critical",
              latitude,
              longitude,
            },
          ]}
          route={[]}
        />
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
