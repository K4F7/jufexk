import { Hono } from "hono";
import type { AppEnv } from "../app-env";
import { handleCampusAuthStatus } from "../campus-jwt";
import { handleCasLogin, handleCasMfa } from "../cas-login";
import {
  handleEmailLoginRequest,
  handleEmailLoginVerify,
} from "../email-login";
import {
  handleRequestOrdinaryUserDeletion,
  handleRestoreOrdinaryUserDeletion,
  USER_DELETION_PATH,
  USER_DELETION_RESTORE_PATH,
} from "../ordinary-user-account";
import {
  handleCampusAuthCallback,
  handleOrdinaryUserLogout,
  handleOrdinaryUserSession,
} from "../ordinary-user-session";
import {
  handleOrdinaryUserProfile,
  USER_PROFILE_PATH,
} from "../ordinary-user-profile";

const authRoutes = new Hono<AppEnv>();
authRoutes.get("/api/user/session", handleOrdinaryUserSession);
authRoutes.get(USER_PROFILE_PATH, handleOrdinaryUserProfile);
authRoutes.post("/api/user/logout", handleOrdinaryUserLogout);
authRoutes.post(USER_DELETION_PATH, handleRequestOrdinaryUserDeletion);
authRoutes.post(USER_DELETION_RESTORE_PATH, handleRestoreOrdinaryUserDeletion);
authRoutes.get("/api/auth/campus", handleCampusAuthStatus);
authRoutes.post("/api/auth/callback", handleCampusAuthCallback);
authRoutes.post("/api/auth/email", handleEmailLoginRequest);
authRoutes.post("/api/auth/verify", handleEmailLoginVerify);
authRoutes.post("/api/auth/cas", handleCasLogin);
authRoutes.post("/api/auth/cas/mfa", handleCasMfa);

export default authRoutes;
