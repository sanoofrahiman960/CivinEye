import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { IssueStatus } from '../types/api';

// --- Auth -----------------------------------------------------------------------

export type AuthStackParamList = {
  Onboarding: undefined;
  RoleSelect: undefined;
  /** Citizens: enter mobile number. */
  PhoneLogin: undefined;
  /** Citizens: enter the SMS code (and their name the first time). */
  OtpVerify: { phoneNumber: string; resendAfter: number; message: string; codeLength: number };
  AuthorityLogin: undefined;
};

export type AuthScreenProps<T extends keyof AuthStackParamList> = NativeStackScreenProps<AuthStackParamList, T>;

// --- Citizen ------------------------------------------------------------------------

export type CitizenTabParamList = {
  Home: undefined;
  MyIssues: { status?: IssueStatus[] } | undefined;
  Map: undefined;
  Notifications: undefined;
  Profile: undefined;
};

export type CitizenStackParamList = {
  CitizenTabs: NavigatorScreenParams<CitizenTabParamList>;
  ReportIssue: undefined;
  ReportSuccess: {
    complaintId: string | null;
    issueId: number | null;
    status: IssueStatus | null;
    address: string;
    latitude: number;
    longitude: number;
    /** True when the report was saved offline and will be sent automatically later. */
    queued: boolean;
  };
  IssueDetail: { issueId: number };
  PendingReports: undefined;
};

export type CitizenStackScreenProps<T extends keyof CitizenStackParamList> = NativeStackScreenProps<CitizenStackParamList, T>;

export type CitizenTabScreenProps<T extends keyof CitizenTabParamList> = CompositeScreenProps<
  BottomTabScreenProps<CitizenTabParamList, T>,
  NativeStackScreenProps<CitizenStackParamList>
>;

// --- Authority ----------------------------------------------------------------------------

export type AuthorityTabParamList = {
  Dashboard: undefined;
  Issues: { status?: IssueStatus[]; overdue?: boolean; priority?: ('CRITICAL' | 'HIGH')[] } | undefined;
  Notifications: undefined;
  Profile: undefined;
};

export type AuthorityStackParamList = {
  AuthorityTabs: NavigatorScreenParams<AuthorityTabParamList>;
  AuthorityIssueDetail: { issueId: number };
  ResolveIssue: { issueId: number };
  Reports: undefined;
};

export type AuthorityStackScreenProps<T extends keyof AuthorityStackParamList> = NativeStackScreenProps<AuthorityStackParamList, T>;

export type AuthorityTabScreenProps<T extends keyof AuthorityTabParamList> = CompositeScreenProps<
  BottomTabScreenProps<AuthorityTabParamList, T>,
  NativeStackScreenProps<AuthorityStackParamList>
>;
