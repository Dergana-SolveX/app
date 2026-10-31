import { useLocale } from "@/contexts/locale-context";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { Link } from "expo-router";
import { Drawer } from "expo-router/drawer";
import { useThemeColor } from "heroui-native";
import React, { useCallback } from "react";
import { Pressable, Text } from "react-native";

import { ThemeToggle } from "@/components/theme-toggle";

function DrawerLayout() {
  const { navigation, direction } = useLocale();
  const themeColorForeground = useThemeColor("foreground");
  const themeColorBackground = useThemeColor("background");

  const renderThemeToggle = useCallback(() => <ThemeToggle />, []);

  return (
    <Drawer
      screenOptions={{
        drawerPosition: direction === "rtl" ? "right" : "left",
        headerTintColor: themeColorForeground,
        headerStyle: { backgroundColor: themeColorBackground },
        headerTitleStyle: {
          fontWeight: "600",
          color: themeColorForeground,
        },
        headerRight: renderThemeToggle,
        drawerStyle: { backgroundColor: themeColorBackground },
      }}
    >
      <Drawer.Screen
        name="index"
        options={{
          headerTitle: navigation.witness,
          drawerLabel: ({ color, focused }) => (
            <Text style={{ color: focused ? color : themeColorForeground }}>{navigation.witness}</Text>
          ),
          drawerIcon: ({ size, color, focused }) => (
            <Ionicons
              name="shield-checkmark"
              size={size}
              style={{ color: focused ? color : themeColorForeground }}
            />
          ),
        }}
      />
      <Drawer.Screen
        name="(tabs)"
        options={{
          headerTitle: navigation.tabs,
          drawerLabel: ({ color, focused }) => (
            <Text style={{ color: focused ? color : themeColorForeground }}>{navigation.tabs}</Text>
          ),
          drawerIcon: ({ size, color, focused }) => (
            <MaterialIcons
              name="border-bottom"
              size={size}
              style={{ color: focused ? color : themeColorForeground }}
            />
          ),
          headerRight: () => (
            <Link href="/modal" asChild>
              <Pressable accessibilityRole="button" accessibilityLabel={navigation.modal} style={{ marginEnd: 16 }}>
                <Ionicons name="add-outline" size={24} style={{ color: themeColorForeground }} />
              </Pressable>
            </Link>
          ),
        }}
      />
    </Drawer>
  );
}

export default DrawerLayout;
