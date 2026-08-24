import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme';

type ToastType = 'success' | 'error' | 'info';

interface ToastState {
  message: string;
  type: ToastType;
  key: number;
}

interface ToastContextValue {
  /** One-line, no-choice notifications (email sent, could not connect, profile saved) — for
   *  anything the operator actually has to make a decision about (confirm/cancel, pick an option),
   *  keep using Alert.alert, which this deliberately does not replace. */
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DURATION_MS: Record<ToastType, number> = { success: 2800, info: 2800, error: 4200 };
const ICON: Record<ToastType, keyof typeof MaterialIcons.glyphMap> = {
  success: 'check-circle',
  error: 'error',
  info: 'info',
};
const ACCENT_COLOR: Record<ToastType, string> = {
  success: colors.brandSuccess,
  error: colors.brandDanger,
  info: colors.brandPrimary,
};

/** App-wide toast/snackbar — mounted once at the root (see App.tsx) so any screen can call
 *  useToast().showToast(...) without wiring its own overlay. Renders as a sibling after
 *  `children`, which is what puts it visually on top of whatever screen is currently mounted. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(16)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextKey = useRef(0);

  const hide = useCallback(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 16, duration: 200, useNativeDriver: true }),
    ]).start(() => setToast(null));
  }, [opacity, translateY]);

  const showToast = useCallback(
    (message: string, type: ToastType = 'info') => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      nextKey.current += 1;
      setToast({ message, type, key: nextKey.current });
      opacity.setValue(0);
      translateY.setValue(16);
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 220, useNativeDriver: true }),
      ]).start();
      hideTimer.current = setTimeout(hide, DURATION_MS[type]);
    },
    [opacity, translateY, hide]
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <Animated.View
          key={toast.key}
          pointerEvents="none"
          style={[styles.container, { opacity, transform: [{ translateY }] }]}
        >
          <View style={[styles.card, { borderLeftColor: ACCENT_COLOR[toast.type] }]}>
            <MaterialIcons name={ICON[toast.type]} size={20} color={ACCENT_COLOR[toast.type]} style={styles.icon} />
            <Text style={styles.text}>{toast.message}</Text>
          </View>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 32,
    alignItems: 'center',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderLeftWidth: 4,
    paddingVertical: 12,
    paddingHorizontal: 14,
    maxWidth: 480,
    width: '100%',
    elevation: 6,
    shadowColor: colors.black,
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  icon: { marginRight: 10 },
  text: { flex: 1, fontSize: 14, color: colors.textPrimary },
});
