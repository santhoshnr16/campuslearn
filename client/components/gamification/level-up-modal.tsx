/**
 * LevelUpModal - Animated celebration when user levels up
 * Features: Star burst animation, confetti, scale bounce
 */
import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Dimensions,
  TouchableOpacity,
} from 'react-native';
import ReAnimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withDelay,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Colors, FontSizes, Spacing, BorderRadius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Spring configs
const SPRING_BOUNCY = { damping: 6, stiffness: 120, mass: 0.8 };
const SPRING_GENTLE = { damping: 15, stiffness: 100, mass: 1 };

// Confetti particle
const ConfettiParticle = ({ 
  delay, 
  color, 
  startX 
}: { 
  delay: number; 
  color: string; 
  startX: number;
}) => {
  const translateY = useSharedValue(0);
  const translateX = useSharedValue(0);
  const opacity = useSharedValue(0);
  const rotate = useSharedValue(0);
  const scale = useSharedValue(0.5);

  useEffect(() => {
    const randomX = (Math.random() - 0.5) * SCREEN_WIDTH * 0.8;
    const randomY = SCREEN_HEIGHT * 0.6 + Math.random() * 200;
    
    translateX.value = withDelay(delay, withSpring(randomX, { damping: 20, stiffness: 40 }));
    translateY.value = withDelay(delay, withTiming(randomY, { 
      duration: 2500, 
      easing: Easing.out(Easing.quad) 
    }));
    opacity.value = withDelay(delay, withSequence(
      withTiming(1, { duration: 100 }),
      withDelay(1800, withTiming(0, { duration: 600 }))
    ));
    rotate.value = withDelay(delay, withTiming(
      Math.random() * 1440 - 720,
      { duration: 2500 }
    ));
    scale.value = withDelay(delay, withSequence(
      withSpring(1, SPRING_BOUNCY),
      withDelay(1500, withTiming(0, { duration: 500 }))
    ));
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { rotate: `${rotate.value}deg` },
      { scale: scale.value },
    ],
    opacity: opacity.value,
    position: 'absolute',
    left: startX,
    top: -20,
    width: 12,
    height: 12,
    borderRadius: 2,
    backgroundColor: color,
  }));

  return <ReAnimated.View style={animatedStyle} />;
};

// Star burst particle
const StarParticle = ({ 
  angle, 
  delay 
}: { 
  angle: number; 
  delay: number;
}) => {
  const distance = useSharedValue(0);
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0);

  useEffect(() => {
    distance.value = withDelay(delay, withSpring(150, { damping: 12, stiffness: 100 }));
    opacity.value = withDelay(delay, withSequence(
      withTiming(1, { duration: 200 }),
      withDelay(400, withTiming(0, { duration: 300 }))
    ));
    scale.value = withDelay(delay, withSequence(
      withSpring(1.2, SPRING_BOUNCY),
      withTiming(0.5, { duration: 400 })
    ));
  }, []);

  const animatedStyle = useAnimatedStyle(() => {
    const x = Math.cos(angle * (Math.PI / 180)) * distance.value;
    const y = Math.sin(angle * (Math.PI / 180)) * distance.value;
    
    return {
      transform: [
        { translateX: x },
        { translateY: y },
        { scale: scale.value },
      ],
      opacity: opacity.value,
    };
  });

  return (
    <ReAnimated.View style={[styles.starParticle, animatedStyle]}>
      <Text style={{ fontSize: 20 }}>⭐</Text>
    </ReAnimated.View>
  );
};

interface LevelUpModalProps {
  visible: boolean;
  newLevel: number;
  xpEarned?: number;
  onClose: () => void;
}

export const LevelUpModal: React.FC<LevelUpModalProps> = ({
  visible,
  newLevel,
  xpEarned = 0,
  onClose,
}) => {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  
  const overlayOpacity = useSharedValue(0);
  const cardScale = useSharedValue(0);
  const cardRotate = useSharedValue(-10);
  const levelScale = useSharedValue(0);
  const levelRotate = useSharedValue(180);
  const titleSlide = useSharedValue(30);
  const titleOpacity = useSharedValue(0);
  const buttonOpacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      
      overlayOpacity.value = withTiming(1, { duration: 300 });
      
      cardScale.value = withDelay(100, withSpring(1, SPRING_BOUNCY));
      cardRotate.value = withDelay(100, withSequence(
        withSpring(5, { damping: 5, stiffness: 200 }),
        withSpring(0, { damping: 10, stiffness: 150 })
      ));
      
      levelScale.value = withDelay(300, withSpring(1, SPRING_BOUNCY));
      levelRotate.value = withDelay(300, withSpring(0, { damping: 8, stiffness: 100 }));
      
      titleSlide.value = withDelay(500, withSpring(0, SPRING_GENTLE));
      titleOpacity.value = withDelay(500, withTiming(1, { duration: 300 }));
      
      buttonOpacity.value = withDelay(800, withTiming(1, { duration: 300 }));
    } else {
      overlayOpacity.value = 0;
      cardScale.value = 0;
      cardRotate.value = -10;
      levelScale.value = 0;
      levelRotate.value = 180;
      titleSlide.value = 30;
      titleOpacity.value = 0;
      buttonOpacity.value = 0;
    }
  }, [visible]);

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: cardScale.value },
      { rotate: `${cardRotate.value}deg` },
    ],
  }));

  const levelStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: levelScale.value },
      { rotateY: `${levelRotate.value}deg` },
    ],
  }));

  const titleStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: titleSlide.value }],
    opacity: titleOpacity.value,
  }));

  const buttonStyle = useAnimatedStyle(() => ({
    opacity: buttonOpacity.value,
  }));

  const getLevelColor = () => {
    if (newLevel >= 20) return '#FFD700'; // Gold
    if (newLevel >= 15) return '#E5E4E2'; // Platinum
    if (newLevel >= 10) return '#34C759'; // Green
    if (newLevel >= 5) return '#007AFF';  // Blue
    return '#FF9500'; // Orange
  };

  const getLevelTitle = () => {
    if (newLevel >= 20) return 'Legendary Scholar';
    if (newLevel >= 15) return 'Master Mind';
    if (newLevel >= 10) return 'Knowledge Expert';
    if (newLevel >= 5) return 'Rising Star';
    return 'Eager Learner';
  };

  // Confetti colors
  const confettiColors = ['#FFD700', '#FF3B30', '#34C759', '#007AFF', '#FF9500', '#AF52DE'];
  
  // Generate confetti particles
  const confetti = Array.from({ length: 40 }, (_, i) => ({
    id: i,
    delay: Math.random() * 400,
    color: confettiColors[Math.floor(Math.random() * confettiColors.length)],
    startX: (SCREEN_WIDTH / 2) + (Math.random() - 0.5) * 100,
  }));

  // Generate star burst
  const stars = Array.from({ length: 12 }, (_, i) => ({
    id: i,
    angle: i * 30,
    delay: 200 + i * 50,
  }));

  return (
    <Modal visible={visible} transparent animationType="none">
      <ReAnimated.View style={[styles.overlay, overlayStyle]}>
        {/* Confetti */}
        {visible && confetti.map((c) => (
          <ConfettiParticle
            key={c.id}
            delay={c.delay}
            color={c.color}
            startX={c.startX}
          />
        ))}

        <ReAnimated.View style={[styles.card, cardStyle, { backgroundColor: colors.background }]}>
          {/* Star Burst */}
          <View style={styles.starBurstContainer}>
            {visible && stars.map((s) => (
              <StarParticle key={s.id} angle={s.angle} delay={s.delay} />
            ))}
          </View>

          {/* Level Badge */}
          <ReAnimated.View style={[styles.levelBadge, levelStyle, { backgroundColor: getLevelColor() }]}>
            <Text style={styles.levelNumber}>{newLevel}</Text>
          </ReAnimated.View>

          {/* Title & Info */}
          <ReAnimated.View style={[styles.infoContainer, titleStyle]}>
            <Text style={styles.celebrationText}>🎊 LEVEL UP! 🎊</Text>
            <Text style={[styles.levelTitle, { color: getLevelColor() }]}>
              {getLevelTitle()}
            </Text>
            <Text style={[styles.levelSubtitle, { color: colors.textSecondary }]}>
              Level {newLevel} unlocked!
            </Text>
            
            {xpEarned > 0 && (
              <View style={[styles.xpBadge, { backgroundColor: colors.primary + '20' }]}>
                <Text style={[styles.xpText, { color: colors.primary }]}>
                  +{xpEarned} XP earned ✨
                </Text>
              </View>
            )}
          </ReAnimated.View>

          {/* Continue Button */}
          <ReAnimated.View style={buttonStyle}>
            <TouchableOpacity
              style={[styles.continueButton, { backgroundColor: getLevelColor() }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onClose();
              }}
            >
              <Text style={styles.continueText}>Continue</Text>
            </TouchableOpacity>
          </ReAnimated.View>
        </ReAnimated.View>
      </ReAnimated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.8)',
  },
  card: {
    width: SCREEN_WIDTH * 0.85,
    borderRadius: BorderRadius.xxl,
    padding: Spacing.xl,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 20,
  },
  starBurstContainer: {
    position: 'absolute',
    top: 80,
    width: 300,
    height: 300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  starParticle: {
    position: 'absolute',
  },
  levelBadge: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: Spacing.lg,
    marginBottom: Spacing.xl,
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  levelNumber: {
    fontSize: 56,
    fontWeight: '900',
    color: '#FFF',
    textShadowColor: 'rgba(0,0,0,0.2)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  infoContainer: {
    alignItems: 'center',
  },
  celebrationText: {
    fontSize: FontSizes.lg,
    fontWeight: '700',
    marginBottom: Spacing.sm,
  },
  levelTitle: {
    fontSize: FontSizes.xxl,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: Spacing.xs,
  },
  levelSubtitle: {
    fontSize: FontSizes.md,
    marginBottom: Spacing.md,
  },
  xpBadge: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: BorderRadius.full,
    marginTop: Spacing.sm,
  },
  xpText: {
    fontSize: FontSizes.sm,
    fontWeight: '700',
  },
  continueButton: {
    marginTop: Spacing.xl,
    paddingHorizontal: 50,
    paddingVertical: 16,
    borderRadius: BorderRadius.xl,
  },
  continueText: {
    color: '#FFF',
    fontSize: FontSizes.md,
    fontWeight: '700',
  },
});
