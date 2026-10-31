import { useLocale } from "@/contexts/locale-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Button, Surface, useThemeColor } from "heroui-native";
import { Text, View } from "react-native";

import { Container } from "@/components/container";

function Modal() {
  const { navigation, direction } = useLocale();
  const accentForegroundColor = useThemeColor("accent-foreground");

  function handleClose() {
    router.back();
  }

  return (
    <Container style={{ direction }}>
      <View className="flex-1 justify-center items-center p-4">
        <Surface variant="secondary" className="p-5 w-full max-w-sm rounded-lg">
          <View className="items-center">
            <View className="w-12 h-12 bg-accent rounded-lg items-center justify-center mb-3">
              <Ionicons name="checkmark" size={24} color={accentForegroundColor} />
            </View>
            <Text className="text-foreground font-medium text-lg mb-1">{navigation.modal}</Text>
            <Text className="text-muted text-sm text-center mb-4">
              {navigation.modalHelp}
            </Text>
          </View>
          <Button onPress={handleClose} className="w-full" size="sm">
            <Button.Label>{navigation.close}</Button.Label>
          </Button>
        </Surface>
      </View>
    </Container>
  );
}

export default Modal;
