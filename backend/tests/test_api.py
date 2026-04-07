"""Tests for the Citadel API endpoints (with auth)."""

import os
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Set required env vars BEFORE importing app
os.environ.setdefault("ADMIN_USERNAME", "testadmin")
os.environ.setdefault("ADMIN_PASSWORD", "testpass123")
os.environ.setdefault("JWT_SECRET", "test-secret-key-for-testing")

from app.main import app
from app.database import Base, get_db


# Test database setup
TEST_DB_URL = "sqlite:///./test_citadel.db"
engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
TestSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestSession()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture(autouse=True)
def setup_db():
    """Create tables before each test, drop after."""
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


client = TestClient(app, raise_server_exceptions=False)


def get_auth_header() -> dict[str, str]:
    """Helper — login and return Authorization header."""
    resp = client.post("/api/auth/login", json={
        "username": "testadmin",
        "password": "testpass123",
    })
    assert resp.status_code == 200
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


class TestAuth:
    def test_login_success(self):
        resp = client.post("/api/auth/login", json={
            "username": "testadmin",
            "password": "testpass123",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"

    def test_login_wrong_password(self):
        resp = client.post("/api/auth/login", json={
            "username": "testadmin",
            "password": "wrongpassword",
        })
        assert resp.status_code == 401

    def test_login_wrong_username(self):
        resp = client.post("/api/auth/login", json={
            "username": "notadmin",
            "password": "testpass123",
        })
        assert resp.status_code == 401

    def test_protected_route_no_token(self):
        resp = client.get("/api/events")
        assert resp.status_code == 401

    def test_protected_route_invalid_token(self):
        resp = client.get("/api/events", headers={"Authorization": "Bearer garbage"})
        assert resp.status_code == 401

    def test_health_no_auth(self):
        resp = client.get("/api/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "healthy"


class TestHealthCheck:
    def test_health(self):
        resp = client.get("/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "healthy"
        assert "version" in data


class TestEvents:
    def test_list_events_empty(self):
        headers = get_auth_header()
        resp = client.get("/api/events", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["events"] == []
        assert data["total"] == 0

    def test_get_event_not_found(self):
        headers = get_auth_header()
        resp = client.get("/api/events/nonexistent-id", headers=headers)
        assert resp.status_code == 404


class TestTickets:
    def test_list_tickets_empty(self):
        headers = get_auth_header()
        resp = client.get("/api/tickets", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["tickets"] == []
        assert data["total"] == 0

    def test_get_ticket_not_found(self):
        headers = get_auth_header()
        resp = client.get("/api/tickets/nonexistent-id", headers=headers)
        assert resp.status_code == 404


class TestStats:
    def test_stats_empty(self):
        headers = get_auth_header()
        resp = client.get("/api/stats", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_events"] == 0
        assert data["total_accidents"] == 0
        assert "severity_breakdown" in data
        assert "timeline_24h" in data


class TestSettings:
    def test_get_settings(self):
        headers = get_auth_header()
        resp = client.get("/api/settings", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "confidence_threshold_manual" in data
        assert "confidence_threshold_cctv" in data
        assert "model_name" in data

    def test_update_settings(self):
        headers = get_auth_header()
        resp = client.put("/api/settings", json={"confidence_threshold_manual": 0.8}, headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["confidence_threshold_manual"] == 0.8
