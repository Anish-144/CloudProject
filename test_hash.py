import bcrypt

hashed = b"$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQyCsqROdR/2IirYSlOk5vjra"
password = b"admin123"

try:
    print(f"Match: {bcrypt.checkpw(password, hashed)}")
except Exception as e:
    print(f"Error: {e}")
