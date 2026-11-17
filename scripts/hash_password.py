from getpass import getpass

from backend.auth import hash_password


if __name__ == "__main__":
    password = getpass("Mật khẩu quản trị: ")
    confirmation = getpass("Nhập lại mật khẩu: ")
    if password != confirmation:
        raise SystemExit("Hai mật khẩu không khớp.")
    if len(password) < 12:
        raise SystemExit("Mật khẩu production phải có ít nhất 12 ký tự.")
    print(hash_password(password))

