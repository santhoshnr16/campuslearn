/**
 * RewardChest - Animated treasure chest opening with particle effects
 * Features: Chest wobble, lid opening animation, coin burst, glow effect
 */
import React, { useEffect, useState } from 'react';
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
  withRepeat,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Colors, FontSizes, Spacing, BorderRadius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Spring configs
const SPRING_BOUNCY = { damping: 6, stiffness: 150, mass: 0.8 };
const SPRING_GENTLE = { damping: 12, stiffness: 100, mass: 1 };

// Coin particle that bursts from chest
const CoinParticle = ({ 
  delay, 
  emoji,
  startY,
}: { 
  delay: number;
  emoji: string;
  startY: number;
}) => {
  const translateY = useSharedValue(0);
  const translateX = useSharedValue(0);
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.5);
  const rotate = useSharedValue(0);

  useEffect(() => {
    const randomX = (Math.random() - 0.5) * 250;
    const randomY = -Math.random() * 200 - 100;
    
    translateX.value = withDelay(delay, withSpring(randomX, { damping: 15, stiffness: 60 }));
    translateY.value = withDelay(delay, withSequence(
      withSpring(randomY, { damping: 12, stiffness: 80 }),
      withDelay(500, withTiming(300, { duration: 1000, easing: Easing.in(Easing.quad) }))
    ));
    opacity.value = withDelay(delay, withSequence(
      withTiming(1, { duration: 150 }),
      withDelay(1200, withTiming(0, { duration: 400 }))
    ));
    scale.value = withDelay(delay, withSequence(
      withSpring(1.2, SPRING_BOUNCY),
      withTiming(0.8, { duration: 800 })
    ));
    rotate.value = withDelay(delay, withTiming(
      (Math.random() - 0.5) * 720,
      { duration: 1800 }
    ));
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
      { rotate: `${rotate.value}deg` },
    ],
    opacity: opacity.value,
    position: 'absolute',
    left: SCREEN_WIDTH / 2 - 15,
    top: startY,
  }));

  return (
    <ReAnimated.View style={animatedStyle}>
      <Text style={{ fontSize: 28 }}>{emoji}</Text>
    </ReAnimated.View>
  );
};

// Glow effect behind chest
const GlowEffect = ({ isOpen }: { isOpen: boolean }) => {
  const glowOpacity = useSharedValue(0);
  const glowScale = useSharedValue(0.5);

  useEffect(() => {
    if (isOpen) {
      glowOpacity.value = withSequence(
        withTiming(0.8, { duration: 300 }),
        withRepeat(
          withSequence(
            withTiming(0.5, { duration: 800 }),
            withTiming(0.8, { duration: 800 })
          ),
          -1,
          true
        )
      );
      glowScale.value = withSpring(1.5, SPRING_GENTLE);
    } else {
      glowOpacity.value = 0;
      glowScale.value = 0.5;
    }
  }, [isOpen]);

  const glowStyle = useAnimatedStyle(() => ({
    transform: [{ scale: glowScale.value }],
    opacity: glowOpacity.value,
  }));

  return (
    <ReAnimated.View style={[styles.glow, glowStyle]} />
  );
};

export interface ChestReward {
  type: 'xp' | 'streak' | 'hearts' | 'badge';
  amount?: number;
  title: string;
  emoji: string;
}

interface RewardChestProps {
  visible: boolean;
  rewards: ChestReward[];
  chestType?: 'bronze' | 'silver' | 'gold';
  onClose: () => void;
  onOpen?: () => void;
}

export const RewardChest: React.FC<RewardChestProps> = ({
  visible,
  rewards,
  chestType = 'gold',
  onClose,
  onOpen,
}) => {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  
  const [isOpen, setIsOpen] = useState(false);
  const [showRewards, setShowRewards] = useState(false);
  
  const overlayOpacity = useSharedValue(0);
  const chestScale = useSharedValue(0);
  const chestWobble = useSharedValue(0);
  const lidRotate = useSharedValue(0);
  const tapTextOpacity = useSharedValue(0);
  const rewardsSlide = useSharedValue(50);
  const rewardsOpacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setIsOpen(false);
      setShowRewards(false);
      
      overlayOpacity.value = withTiming(1, { duration: 300 });
      chestScale.value = withDelay(200, withSpring(1, SPRING_BOUNCY));
      
      // Start wobble animation
      chestWobble.value = withDelay(400, withRepeat(
        withSequence(
          withTiming(-3, { duration: 100 }),
          withTiming(3, { duration: 100 }),
          withTiming(-2, { duration: 100 }),
          withTiming(2, { duration: 100 }),
          withTiming(0, { duration: 100 })
        ),
        -1,
        false
      ));
      
      tapTextOpacity.value = withDelay(600, withTiming(1, { duration: 300 }));
    } else {
      overlayOpacity.value = 0;
      chestScale.value = 0;
      chestWobble.value = 0;
      lidRotate.value = 0;
      tapTextOpacity.value = 0;
      rewardsSlide.value = 50;
      rewardsOpacity.value = 0;
    }
  }, [visible]);

  const openChest = () => {
    if (isOpen) return;
    
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setIsOpen(true);
    onOpen?.();
    
    // Stop wobble
    chestWobble.value = 0;
    tapTextOpacity.value = withTiming(0, { duration: 200 });
    
    // Lid animation
    lidRotate.value = withSpring(-110, { damping: 5, stiffness: 100 });
    
    // Show rewards after particles
    setTimeout(() => {
      setShowRewards(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      rewardsSlide.value = withSpring(0, SPRING_GENTLE);
      rewardsOpacity.value = withTiming(1, { duration: 400 });
    }, 800);
  };

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  const chestStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: chestScale.value },
      { rotate: `${chestWobble.value}deg` },
    ],
  }));

  const lidStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 1000 },
      { rotateX: `${lidRotate.value}deg` },
    ],
  }));

  const tapTextStyle = useAnimatedStyle(() => ({
    opacity: tapTextOpacity.value,
  }));

  const rewardsStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: rewardsSlide.value }],
    opacity: rewardsOpacity.value,
  }));

  const getChestEmoji = () => {
    switch (chestType) {
      case 'gold': return '🎁';
      case 'silver': return '📦';
      case 'bronze': return '🗃️';
      default: return '🎁';
    }
  };

  const getChestColor = () => {
    switch (chestType) {
      case 'gold': return '#FFD700';
      case 'silver': return '#C0C0C0';
      case 'bronze': return '#CD7F32';
      default: return '#FFD700';
    }
  };

  // Particle emojis for burst
  const particleEmojis = ['💎', '⭐', '✨', '💰', '🌟', '🎯', '💫', '🔮'];
  
  // Generate particles
  const particles = Array.from({ length: 20 }, (_, i) => ({
    id: i,
    delay: Math.random() * 300,
    emoji: particleEmojis[Math.floor(Math.random() * particleEmojis.length)],
    startY: SCREEN_HEIGHT / 2 - 60,
  }));

  return (
    <Modal visible={visible} transparent animationType="none">
      <ReAnimated.View style={[styles.overlay, overlayStyle]}>
        {/* Glow effect */}
        <GlowEffect isOpen={isOpen} />
        
        {/* Particles */}
        {isOpen && particles.map((p) => (
          <CoinParticle
            key={p.id}
            delay={p.delay}
            emoji={p.emoji}
            startY={p.startY}
          />
        ))}

        {/* Chest */}
        <TouchableOpacity onPress={openChest} activeOpacity={1}>
          <ReAnimated.View style={[styles.chestContainer, chestStyle]}>
            {/* Chest base */}
            <View style={[styles.chestBase, { backgroundColor: getChestColor() }]}>
              <View style={styles.chestFront}>
                <View style={[styles.chestLock, { backgroundColor: isOpen ? '#888' : '#666' }]} />
              </View>
            </View>
            
            {/* Chest lid */}
            <ReAnimated.View style={[styles.chestLid, lidStyle, { backgroundColor: getChestColor() }]}>
              <View style={styles.lidInner} />
            </ReAnimated.View>
            
            {/* Chest emoji (simplified visual) */}
            <Text style={styles.chestEmoji}>{getChestEmoji()}</Text>
          </ReAnimated.View>
        </TouchableOpacity>

        {/* Tap to open text */}
        {!isOpen && (
          <ReAnimated.View style={[styles.tapTextContainer, tapTextStyle]}>
            <Text style={styles.tapText}>👆 Tap to Open!</Text>
          </ReAnimated.View>
        )}

        {/* Rewards Display */}
        {showRewards && (
          <ReAnimated.View style={[styles.rewardsContainer, rewardsStyle, { backgroundColor: colors.background }]}>
            <Text style={[styles.rewardsTitle, { color: colors.text }]}>
              🎉 You Got:
            </Text>
            
            {rewards.map((reward, index) => (
              <View key={index} style={[styles.rewardItem, { borderColor: colors.border }]}>
                <Text style={styles.rewardEmoji}>{reward.emoji}</Text>
                <View style={styles.rewardInfo}>
                  <Text style={[styles.rewardTitle, { color: colors.text }]}>
                    {reward.title}
                  </Text>
                  {reward.amount !== undefined && (
                    <Text style={[styles.rewardAmount, { color: getChestColor() }]}>
                      +{reward.amount}
                    </Text>
                  )}
                </View>
              </View>
            ))}
            
            <TouchableOpacity
              style={[styles.collectButton, { backgroundColor: getChestColor() }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onClose();
              }}
            >
              <Text style={styles.collectText}>Collect Rewards! 🎊</Text>
            </TouchableOpacity>
          </ReAnimated.View>
        )}
      </ReAnimated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.85)',
  },
  glow: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: '#FFD700',
    opacity: 0.3,
  },
  chestContainer: {
    width: 150,
    height: 120,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chestBase: {
    position: 'absolute',
    bottom: 0,
    width: 120,
    height: 70,
    borderRadius: 10,
    borderWidth: 4,
    borderColor: 'rgba(0,0,0,0.2)',
  },
  chestFront: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chestLock: {
    width: 20,
    height: 24,
    borderRadius: 4,
    marginTop: 10,
  },
  chestLid: {
    position: 'absolute',
    top: 10,
    width: 130,
    height: 50,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 4,
    borderBottomWidth: 0,
    borderColor: 'rgba(0,0,0,0.2)',
    transformOrigin: 'bottom',
  },
  lidInner: {
    flex: 1,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.2)',
    margin: 4,
  },
  chestEmoji: {
    fontSize: 80,
    position: 'absolute',
  },
  tapTextContainer: {
    position: 'absolute',
    bottom: SCREEN_HEIGHT * 0.25,
  },
  tapText: {
    color: '#FFF',
    fontSize: FontSizes.lg,
    fontWeight: '700',
  },
  rewardsContainer: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -5 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 10,
  },
  rewardsTitle: {
    fontSize: FontSizes.xl,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  rewardItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    marginBottom: Spacing.xs,
  },
  rewardEmoji: {
    fontSize: 32,
    marginRight: Spacing.md,
  },
  rewardInfo: {
    flex: 1,
  },
  rewardTitle: {
    fontSize: FontSizes.md,
    fontWeight: '600',
  },
  rewardAmount: {
    fontSize: FontSizes.lg,
    fontWeight: '800',
    marginTop: 2,
  },
  collectButton: {
    marginTop: Spacing.md,
    paddingVertical: 14,
    borderRadius: BorderRadius.lg,
    alignItems: 'center',
  },
  collectText: {
    color: '#FFF',
    fontSize: FontSizes.md,
    fontWeight: '700',
  },
});
