import { Stack } from 'expo-router';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

export default function HomeStackLayout() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];


  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTransparent: true,
        headerStyle: {
          backgroundColor: 'transparent',
        },
        headerTintColor: colors.primary,
        headerTitleStyle: {
          fontWeight: '600',
          color: colors.text,
        },
        headerShadowVisible: false,
        headerBackTitle: 'Back',
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="subjects"
        options={{
          title: 'Subjects',
        }}
      />
      <Stack.Screen
        name="subject-detail"
        options={{
          title: 'Subject Details',
        }}
      />
      <Stack.Screen
        name="generate"
        options={{
          title: 'Rubric Generator',
        }}
      />
      <Stack.Screen
        name="vetting"
        options={{
          title: 'Question Vetting',
        }}
      />
      <Stack.Screen
        name="reports"
        options={{
          title: 'Reports',
        }}
      />
      <Stack.Screen
        name="questions"
        options={{
          title: 'Questions',
        }}
      />
      <Stack.Screen
        name="profile"
        options={{
          title: 'Profile',
          presentation: 'modal',
          headerShown: true,
          headerBackTitle: 'Back',
        }}
      />
      <Stack.Screen
        name="enrollments"
        options={{
          title: 'Enrollments',
        }}
      />
    </Stack>
  );
}
