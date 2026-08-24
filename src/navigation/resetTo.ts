import { CommonActions } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import { RootStackParamList } from './types';

/**
 * Clears the entire back stack and lands on `routeName` — the RN equivalent of the native app's
 * repeated `NavOptions.Builder().setPopUpTo(R.id.nav_graph, true).build()` pattern (used after
 * Consent, after Setup's Login/Skip choice, and after a successful Login), so pressing Back from
 * wherever this lands never bounces back through onboarding/auth screens that already did their
 * job.
 */
export function resetTo<RouteName extends keyof RootStackParamList>(
  navigation: NavigationProp<RootStackParamList>,
  routeName: RouteName,
  params?: RootStackParamList[RouteName]
) {
  navigation.dispatch(
    CommonActions.reset({
      index: 0,
      routes: [{ name: routeName as string, params: params as object | undefined }],
    })
  );
}
