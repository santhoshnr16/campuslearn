import { SymbolView, SymbolViewProps, SymbolWeight } from 'expo-symbols';
import { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useEffect } from 'react';

type SymbolAnimationEffect = 'bounce' | 'pulse' | 'variableColor' | undefined;

/**
 * iOS 26 native SF Symbols component with:
 * - Full SF Symbols 6 support
 * - Native symbol effects (bounce, pulse, variableColor)
 * - Automatic rendering mode selection
 * - Variable weight support
 */
export function IconSymbol({
  name,
  size = 24,
  color,
  style,
  weight = 'regular',
  animationEffect,
}: {
  name: SymbolViewProps['name'];
  size?: number;
  color: string;
  style?: StyleProp<ViewStyle>;
  weight?: SymbolWeight;
  animationEffect?: SymbolAnimationEffect;
}) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (animationEffect === 'bounce') {
      // Single bounce on selection
      scale.value = withSequence(
        withSpring(1.15, { damping: 10, stiffness: 400 }),
        withSpring(1, { damping: 12, stiffness: 400 })
      );
    } else if (animationEffect === 'pulse') {
      // Subtle pulse for emphasis
      opacity.value = withSequence(
        withTiming(0.6, { duration: 150 }),
        withTiming(1, { duration: 150 })
      );
      scale.value = withSequence(
        withSpring(1.1, { damping: 10, stiffness: 400 }),
        withSpring(1, { damping: 12, stiffness: 400 })
      );
    }
  }, [animationEffect]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={[
      {
        width: size,
        height: size,
      },
      style,
      animatedStyle,
    ]}>
      <SymbolView
        weight={weight}
        tintColor={color}
        resizeMode="scaleAspectFit"
        name={name}
        style={{
          width: size,
          height: size,
        }}
        // iOS 26 symbol effects
        animationSpec={animationEffect ? {
          effect: {
            type: animationEffect as any,
          },
        } : undefined}
      />
    </Animated.View>
  );
}
