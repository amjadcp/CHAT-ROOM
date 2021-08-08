import threading
import socket

host = '127.0.0.1'
port = 55555

server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
server.bind((host, port))
server.listen()

clients = []
user_names = []

def broadcast(message):
    for client in clients:
        client.send(message)

def handle(client):
    while True:
        try:
            message = client.rev(1024)
            broadcast(message)
        except:
            i = clients.index(client)
            clients.remove(client)
            client.close()
            user_name = user_names[i]
            broadcast(f'{user_name} left !!!'.encode('ascii'))
            user_names.remove(user_name)
            break

def receive():
    while True:
        client, address = server.accept()
        print(f'{str(address)} connected')

        client.send('NICK'.encode('ascii'))
        user_name = client.recv(1024).decode('ascii')
        user_names.append(user_name)
        clients.append(client)

        print(f'{user_name} - {client}')
        broadcast(f'{user_name} has joined in room'.encode('ascii'))
        client.send('Connected !!!'.encode('ascii'))

        thread = threading.Thread(target=handle, args=(client,))
        thread.start()

print('Server up....')
receive()