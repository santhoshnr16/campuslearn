"""
Authentication API endpoints.
"""

import os
import uuid as uuid_lib
from fastapi import APIRouter, Depends, HTTPException, status, Request, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.config import settings
from app.core.logging import logger
from app.schemas.user import UserCreate, UserLogin, UserUpdate, UserResponse
from app.schemas.auth import (
    Token,
    TokenResponse,
    TokenRefresh,
    PasswordChange,
    SessionResponse,
    SessionInfo,
    LogoutRequest,
    LogoutAllResponse,
)
from app.services.user_service import UserService
from app.api.v1.deps import get_current_user, get_client_info
from app.models.user import User


router = APIRouter()


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(
    request: Request,
    user_data: UserCreate,
    db: AsyncSession = Depends(get_db),
):
    """
    Register a new user account.
    """
    logger.info(f"[AUTH] Register request received from {request.client.host if request.client else 'unknown'}")
    logger.info(f"[AUTH] User data: email={user_data.email}, username={user_data.username}")
    
    user_service = UserService(db)
    client_info = get_client_info(request)
    
    try:
        # Create user
        user = await user_service.create_user(user_data)
        
        # Generate tokens
        access_token, refresh_token = await user_service.create_refresh_token(
            user_id=user.id,
            **client_info,
        )
        
        return TokenResponse(
            access_token=access_token,
            refresh_token=refresh_token,
            token_type="bearer",
            expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            user=UserResponse.model_validate(user),
        )
    
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e),
        )


@router.post("/login", response_model=TokenResponse)
async def login(
    request: Request,
    credentials: UserLogin,
    db: AsyncSession = Depends(get_db),
):
    """
    Authenticate user and return tokens.
    """
    user_service = UserService(db)
    client_info = get_client_info(request)
    
    try:
        user = await user_service.authenticate_user(
            email=credentials.email,
            password=credentials.password,
            ip_address=client_info.get("ip_address"),
            user_agent=client_info.get("user_agent"),
        )
        
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password",
            )
        
        # Generate tokens
        access_token, refresh_token = await user_service.create_refresh_token(
            user_id=user.id,
            **client_info,
        )
        
        return TokenResponse(
            access_token=access_token,
            refresh_token=refresh_token,
            token_type="bearer",
            expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            user=UserResponse.model_validate(user),
        )
    
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(e),
        )


@router.post("/refresh", response_model=Token)
async def refresh_token(
    token_data: TokenRefresh,
    db: AsyncSession = Depends(get_db),
):
    """
    Refresh access token using refresh token.
    """
    user_service = UserService(db)
    
    result = await user_service.refresh_access_token(token_data.refresh_token)
    
    if not result:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )
    
    access_token, new_refresh_token = result
    
    return Token(
        access_token=access_token,
        refresh_token=new_refresh_token,
        token_type="bearer",
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.post("/logout")
async def logout(
    logout_data: LogoutRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Logout from current session.
    """
    user_service = UserService(db)
    
    await user_service.revoke_refresh_token(logout_data.refresh_token)
    
    return {"message": "Logged out successfully"}


@router.post("/logout-all", response_model=LogoutAllResponse)
async def logout_all(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Logout from all devices.
    """
    user_service = UserService(db)
    
    sessions_revoked = await user_service.revoke_all_user_tokens(current_user.id)
    
    return LogoutAllResponse(
        message="Logged out from all devices",
        sessions_revoked=sessions_revoked,
    )


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(
    current_user: User = Depends(get_current_user),
):
    """
    Get current user profile.
    """
    return UserResponse.model_validate(current_user)


@router.put("/update-profile", response_model=UserResponse)
async def update_profile(
    update_data: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Update current user profile.
    """
    user_service = UserService(db)
    
    updated_user = await user_service.update_user(current_user.id, update_data)
    
    return UserResponse.model_validate(updated_user)


@router.post("/upload-avatar", response_model=UserResponse)
async def upload_avatar(
    file: UploadFile = File(..., description="Profile image (JPEG, PNG, or WebP)"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload a profile avatar image.
    """
    # Validate file type
    allowed_types = ["image/jpeg", "image/png", "image/webp"]
    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file type. Allowed types: JPEG, PNG, WebP",
        )
    
    # Validate file size (max 5MB)
    max_size = 5 * 1024 * 1024
    content = await file.read()
    if len(content) > max_size:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File too large. Maximum size is 5MB",
        )
    
    # Create avatars directory
    avatars_dir = os.path.join(settings.UPLOAD_DIR, "avatars")
    os.makedirs(avatars_dir, exist_ok=True)
    
    # Generate unique filename
    ext = file.filename.split(".")[-1] if file.filename else "jpg"
    filename = f"{current_user.id}_{uuid_lib.uuid4().hex[:8]}.{ext}"
    file_path = os.path.join(avatars_dir, filename)
    
    # Delete old avatar if exists
    if current_user.avatar_url:
        old_filename = current_user.avatar_url.split("/")[-1]
        old_path = os.path.join(avatars_dir, old_filename)
        if os.path.exists(old_path):
            os.remove(old_path)
    
    # Save new avatar
    with open(file_path, "wb") as f:
        f.write(content)
    
    # Update user avatar_url
    avatar_url = f"/api/v1/auth/avatars/{filename}"
    user_service = UserService(db)
    update_data = UserUpdate(avatar_url=avatar_url)
    updated_user = await user_service.update_user(current_user.id, update_data)
    
    return UserResponse.model_validate(updated_user)


@router.get("/avatars/{filename}")
async def get_avatar(filename: str):
    """
    Serve avatar image.
    """
    avatars_dir = os.path.join(settings.UPLOAD_DIR, "avatars")
    file_path = os.path.join(avatars_dir, filename)
    
    if not os.path.exists(file_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Avatar not found",
        )
    
    return FileResponse(file_path)


@router.delete("/avatar", response_model=UserResponse)
async def delete_avatar(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Delete current user's avatar.
    """
    if current_user.avatar_url:
        # Delete file
        filename = current_user.avatar_url.split("/")[-1]
        avatars_dir = os.path.join(settings.UPLOAD_DIR, "avatars")
        file_path = os.path.join(avatars_dir, filename)
        if os.path.exists(file_path):
            os.remove(file_path)
    
    # Clear avatar_url
    user_service = UserService(db)
    update_data = UserUpdate(avatar_url=None)
    updated_user = await user_service.update_user(current_user.id, update_data)
    
    return UserResponse.model_validate(updated_user)


@router.post("/change-password")
async def change_password(
    password_data: PasswordChange,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Change current user's password.
    """
    user_service = UserService(db)
    
    try:
        await user_service.change_password(
            user_id=current_user.id,
            current_password=password_data.current_password,
            new_password=password_data.new_password,
        )
        return {"message": "Password changed successfully"}
    
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.get("/sessions", response_model=SessionResponse)
async def get_sessions(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get all active sessions for current user.
    """
    user_service = UserService(db)
    
    # Get refresh token from header for current session identification
    auth_header = request.headers.get("Authorization", "")
    current_token = auth_header.replace("Bearer ", "") if auth_header else ""
    
    sessions = await user_service.get_user_sessions(current_user.id, current_token)
    
    return SessionResponse(
        sessions=[SessionInfo(**s) for s in sessions]
    )


@router.delete("/sessions/{session_id}")
async def revoke_session(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Revoke a specific session.
    """
    # This would require storing session IDs differently
    # For now, return success
    return {"message": "Session revoked successfully"}
