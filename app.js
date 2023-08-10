let express = require("express");
let cors = require("cors");
let socketio = require("socket.io");
let wrtc = require("wrtc");
const app = express();
let http = require("http");
const { unwatchFile } = require("fs");
const server = http.createServer(app);

app.use(cors());

let receiverPCs = {}; //접속한 user의 MediaStream을 받기 위한 RTCPeerConnection을 저장
let senderPCs = {}; //한 user에게 자신을 제외한 다른 user의 MediaStream을 보내기 위한 RTCPeerConnection을 저장

let users = {}; //receiverPCs에서 연결된 RTCPeerConnection을 통해 받은 MediaStream을 user의 socketID와 함께 저장
let socketToRoom = {}; //user가 어떤 room에 속해 있는 지 저장

const pc_config = {
    iceServers: [
        // {
        //   urls: 'stun:[STUN_IP]:[PORT]',
        //   'credentials': '[YOR CREDENTIALS]',
        //   'username': '[USERNAME]'
        // },
        {
            urls: "stun:stun.l.google.com:19302",
        },
        // {
        //     urls: "turn:a.relay.metered.ca:80",
        //     username: "58e686be527c0068cfb5ba6d",
        //     credential: "ka326fwi9Pp+JP8w",
        // },
        {
            urls: "turn:a.relay.metered.ca:80",
            username: "58e686be527c0068cfb5ba6d",
            credential: "ka326fwi9Pp+JP8w",
        },
        // {
        //     urls: "turn:a.relay.metered.ca:443",
        //     username: "58e686be527c0068cfb5ba6d",
        //     credential: "ka326fwi9Pp+JP8w",
        // },
        // {
        //     urls: "turn:a.relay.metered.ca:443?transport=tcp",
        //     username: "58e686be527c0068cfb5ba6d",
        //     credential: "ka326fwi9Pp+JP8w",
        // },
    ],
};

//배열 내의 Dictionary 중 id가 일치하는 것이 존재하는 지 여부 반환
const isIncluded = (array, id) => array.some((item) => item.id === id);

//user의 socketID를 key로 한 receiverPCs의 value로 새로 생성한 pc를 저장하고 그 pc를 통해 user의 MediaStream을 전달받는 이벤트 생성
const createReceiverPeerConnection = (socketID, socket, roomID) => {
    const pc = new wrtc.RTCPeerConnection(pc_config);

    if (receiverPCs[socketID]) receiverPCs[socketID] = pc;
    else receiverPCs = { ...receiverPCs, [socketID]: pc };

    pc.onicecandidate = (e) => {

        console.log("emit::getSenderCandidate");
        console.log(`socketID: ${socketID}'s receiverPeerConnection icecandidate`);

        console.log(e.candidate);
        console.log("emit::getSenderCandidate");


        //이놈 동작 안함. 이놈이 문제구나?
        //본인에게 전송을 안함. socket -> io로 변경함
        // if (e.candidate != null) {
        io.to(socketID).emit("getSenderCandidate", {
            candidate: e.candidate,
        });
        // }

    };

    pc.oniceconnectionstatechange = (e) => {
        //console.log(e);
    };




    pc.ontrack = (e) => {

        if (users[roomID]) {
            if (!isIncluded(users[roomID], socketID)) {
                users[roomID].push({
                    id: socketID,
                    stream: e.streams[0],
                });
            } else return;
        } else {
            users[roomID] = [
                {
                    id: socketID,
                    stream: e.streams[0],
                },
            ];
        }

        console.log("::userEnter");
        console.log(socketID);
        console.log(roomID);
        console.log("::userEnter");

        //이거 실행 된 걸까? - 보낸 사람에게 안보낸게 맞음
        //socket.broadcast.emit : sender인 socket의 클라이언트는 제외 
        socket.broadcast.to(roomID).emit("userEnter", { id: socketID });
    };

    return pc;
};

//senderSocketID를 socket id로 가진 user의 MediaStream을 receiverSockerID를 socket id 로 가진 user에게 전달하기 위한 RTCPeerConnection을 생성하고 해당 RTCPeerConnection에 senderSocketID user의 videotrack, audiotrack을 추가한다.
const createSenderPeerConnection = (
    receiverSocketID,
    senderSocketID,
    socket,
    roomID
) => {
    const pc = new wrtc.RTCPeerConnection(pc_config);

    if (senderPCs[senderSocketID]) {
        senderPCs[senderSocketID].filter((user) => user.id !== receiverSocketID);
        senderPCs[senderSocketID].push({ id: receiverSocketID, pc });
    } else
        senderPCs = {
            ...senderPCs,
            [senderSocketID]: [{ id: receiverSocketID, pc }],
        };

    pc.onicecandidate = (e) => {
        //console.log(`socketID: ${receiverSocketID}'s senderPeerConnection icecandidate`);

        console.log("emit::getReceiverCandidate");
        console.log(senderSocketID);
        console.log(e.candidate);
        console.log("emit::getReceiverCandidate");


        //socket -> io로 변경함
        io.to(receiverSocketID).emit("getReceiverCandidate", {
            id: senderSocketID,
            candidate: e.candidate,
        });
    };

    pc.oniceconnectionstatechange = (e) => {
        //console.log(e);
    };

    const sendUser = users[roomID].filter(
        (user) => user.id === senderSocketID
    )[0];
    sendUser.stream.getTracks().forEach((track) => {
        pc.addTrack(track, sendUser.stream);
    });

    return pc;
};

//방에 회원 추가 
//자신을 제외하고 room ID에 포함된 모든 유저의 socket id 배열을 반환
const getOtherUsersInRoom = (socketID, roomID) => {
    let allUsers = [];

    if (!users[roomID]) return allUsers;

    allUsers = users[roomID]
        .filter((user) => user.id !== socketID)
        .map((otherUser) => ({ id: otherUser.id }));

    //내 id 말고 상대에게만 전송하도록 하는 것
    // console.log("*****");
    // console.log(users);
    // console.log(socketID);
    // console.log(roomID);

    // console.log(allUsers);
    // console.log("*****");

    return allUsers;
};

const deleteUser = (socketID, roomID) => {
    if (!users[roomID]) return;
    users[roomID] = users[roomID].filter((user) => user.id !== socketID);
    if (users[roomID].length === 0) {
        delete users[roomID];
    }
    delete socketToRoom[socketID];
};

const closeReceiverPC = (socketID) => {
    if (!receiverPCs[socketID]) return;

    receiverPCs[socketID].close();
    delete receiverPCs[socketID];
};

const closeSenderPCs = (socketID) => {
    if (!senderPCs[socketID]) return;

    senderPCs[socketID].forEach((senderPC) => {
        senderPC.pc.close();
        const eachSenderPC = senderPCs[senderPC.id].filter(
            (sPC) => sPC.id === socketID
        )[0];
        if (!eachSenderPC) return;
        eachSenderPC.pc.close();
        senderPCs[senderPC.id] = senderPCs[senderPC.id].filter(
            (sPC) => sPC.id !== socketID
        );
    });

    delete senderPCs[socketID];
};

// const io = socketio(server);
const io = socketio(server, {
    cors: {
        origin: "http://localhost:3000",
        methods: ["GET", "POST"]
        // allwoedHeaders: ["*"],
        // credentials: true
    }
});

io.on("connection", socket => {
    console.log("on::connection");
    console.log(socket.id);
    console.log("on::connection");


    //방 참가
    //기존에 room에 들어와 자신의 MediaStream을 서버에게 전송하고 있는 user들의 socket id 목록을 지금 들어온 user에게 전송
    socket.on("joinRoom", (data) => {
        console.log("on::joinRoom");
        console.log(data);
        console.log("on::joinRoom");

        try {
            let allUsers = getOtherUsersInRoom(data.id, data.roomID);

            //방 참여후 모든 유저에게 보내주는 부분 (나 말고 다른 유저에게)
            // console.log("emit::allUsers");
            // console.log(allUsers);

            // console.log(receiverPCs); //입장한 두 스트림 갖고잇음
            // console.log(senderPCs);
            // console.log(users); // 두번째 입장 후 부터 상대방 것이 생성됨
            // console.log(socketToRoom); //입장한 두 스트림 갖고잇음
            // console.log("emit::allUsers");



            //내 id 빼고 보내주는 부분.
            io.to(data.id).emit("allUsers", { users: allUsers });
        } catch (error) {
            console.log(error);
        }
    });

    //1. offer 메세지 전송
    //user의 MediaStream을 받을 RTCPeerConnection의 offer를 서버가 받고 answer을 보냄
    socket.on("senderOffer", async (data) => {
        console.log("on::senderOffer");
        // console.log(data);
        console.log(socket);
        console.log("on::senderOffer");

        // io.to(data.senderSocketID).emit("gettest", {
        //     candidate: "123",
        // });

        try {
            socketToRoom[data.senderSocketID] = data.roomID;
            let pc = createReceiverPeerConnection(
                data.senderSocketID,
                socket,
                data.roomID
            );
            await pc.setRemoteDescription(data.sdp);
            let sdp = await pc.createAnswer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true,
            });
            await pc.setLocalDescription(sdp);
            socket.join(data.roomID);


            // console.log("emit::getSenderAnswer");
            // console.log(sdp);
            // console.log("emit::getSenderAnswer");
            io.to(data.senderSocketID).emit("getSenderAnswer", { sdp });
        } catch (error) {
            console.log(error);
        }
    });

    //해당 user가 offer를 보낼 때 저장해놓은 RTCPeerConnection에 RTCIceCandidate를 추가
    socket.on("senderCandidate", async (data) => {
        console.log("on::senderCandidate");
        console.log(data);
        console.log("on::senderCandidate");

        try {
            let pc = receiverPCs[data.senderSocketID];
            await pc.addIceCandidate(new wrtc.RTCIceCandidate(data.candidate));
        } catch (error) {
            console.log(error);
        }
    });

    //receiverSocketID를 socket id로 가지는 user가 senderSocketID를 socket id로 가지는 user의 MediaStream을 받기 위한 RTCPeerConnection의 offer를 서버가 받고 answer을 보냄
    socket.on("receiverOffer", async (data) => {
        console.log("on::receiverOffer");
        console.log(data);
        console.log("on::receiverOffer");

        try {
            let pc = createSenderPeerConnection(
                data.receiverSocketID,
                data.senderSocketID,
                socket,
                data.roomID
            );
            await pc.setRemoteDescription(data.sdp);
            let sdp = await pc.createAnswer({
                offerToReceiveAudio: false,
                offerToReceiveVideo: false,
            });
            await pc.setLocalDescription(sdp);

            // console.log("emit::getReceiverAnswer");
            // console.log(data.senderSocketID);
            // console.log("emit::getReceiverAnswer");

            io.to(data.receiverSocketID).emit("getReceiverAnswer", {
                id: data.senderSocketID,
                sdp,
            });
        } catch (error) {
            console.log(error);
        }
    });

    //receiverSocketID를 socket id로 가지는 user가 offer를 보낼 때 저장해놓은 RTCPeerConnection에 RTCIceCandidate를 추가
    socket.on("receiverCandidate", async (data) => {
        console.log("on::receiverCandidate");
        console.log(data);
        console.log("on::receiverCandidate");

        try {
            const senderPC = senderPCs[data.senderSocketID].filter(
                (sPC) => sPC.id === data.receiverSocketID
            )[0];
            await senderPC.pc.addIceCandidate(
                new wrtc.RTCIceCandidate(data.candidate)
            );
        } catch (error) {
            console.log(error);
        }
    });

    //disconnect된 user와 연결되어 있는 모든 RTCPeerConnection 및 MedaiStream을 해제
    socket.on("disconnect", () => {
        console.log("on::disconnect");

        try {
            let roomID = socketToRoom[socket.id];

            deleteUser(socket.id, roomID);
            closeReceiverPC(socket.id);
            closeSenderPCs(socket.id);

            // console.log("emit::userExit");
            // console.log(socket.id);
            // console.log("emit::userExit");

            socket.broadcast.to(roomID).emit("userExit", { id: socket.id });
        } catch (error) {
            console.log(error);
        }
    });
});

// server.listen(process.env.PORT || 8080, () => {
//     console.log("server running on 8080");
//     console.log(process.env.PORT);
// });
server.listen(3000, function () {
    console.log("Express server has started on port 3000")
});