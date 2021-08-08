import socket
import threading

user_name = input("Set user name :")

client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
client.connect(('127.0.0.1', 8080))


def receive():
    while True:
        try:
            message = client.recv(1024).decode('ascii')
            if message == 'NICK':
                client.send(user_name.encode('ascii'))
            else:
                print(message)
        except:
            print('Somthing gone wrong!!!!')
            client.close()
            break

def write():
    while True:
        message = f'{user_name} : {input("")}'
        client.send(message.encode('ascii'))

receive_tread = threading.Thread(target=receive)
receive_tread.start()

write_tread = threading.Thread(target=write)
write_tread.start()