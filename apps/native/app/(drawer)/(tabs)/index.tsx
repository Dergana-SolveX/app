import { useLocale } from "@/contexts/locale-context";
import { Card } from "heroui-native";
import { Text, View } from "react-native";

import { Container } from "@/components/container";

export default function Home() {
  const { navigation, direction } = useLocale();
  return (
    <Container style={{ direction }} className="p-6">
      <View className="flex-1 justify-center items-center">
        <Card variant="secondary" className="p-8 items-center">
          <Card.Title className="text-3xl mb-2">{navigation.home}</Card.Title>
        </Card>
      </View>
    </Container>
  );
}
